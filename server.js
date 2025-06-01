const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const path = require('path');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const port = 3000;

// Configure CORS
app.use(cors({
    origin: '*', // In production, replace with your actual domain
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.static('public'));

// Create temp directory if it doesn't exist
const tempDir = path.join(os.tmpdir(), 'videovortex');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// Helper function to get best format for quality
function getBestFormat(formats, quality) {
    // For audio-only format
    if (quality === 'audio') {
        return formats.find(format => !format.hasVideo && format.hasAudio);
    }

    // Get the requested height
    const requestedHeight = parseInt(quality.replace('p', ''));
    console.log('Requested height:', requestedHeight);

    // Get all formats with video
    const allFormats = formats.filter(format => {
        return format.hasVideo && 
               format.container === 'mp4' &&
               parseInt(format.height) === requestedHeight;
    });

    console.log('All matching formats:', allFormats.map(f => ({
        quality: f.qualityLabel,
        hasAudio: f.hasAudio,
        itag: f.itag,
        container: f.container
    })));

    // Try to find format with both video and audio
    const combinedFormat = allFormats.find(f => f.hasAudio);
    if (combinedFormat) {
        return combinedFormat;
    }

    // Get best video-only format
    const videoFormat = allFormats
        .sort((a, b) => parseInt(b.bitrate) - parseInt(a.bitrate))[0];

    if (!videoFormat) {
        return null;
    }

    // Get best audio format
    const audioFormat = formats
        .filter(format => !format.hasVideo && format.hasAudio)
        .sort((a, b) => parseInt(b.audioBitrate || 0) - parseInt(a.audioBitrate || 0))[0];

    if (!audioFormat) {
        return null;
    }

    return {
        videoFormat,
        audioFormat,
        needsMerge: true
    };
}

// Helper function to get available formats
function getAvailableFormats(formats) {
    // Get all video formats
    const videoFormats = formats.filter(format => 
        format.hasVideo && 
        format.container === 'mp4'
    );

    // Get available heights
    const availableHeights = [...new Set(videoFormats.map(f => parseInt(f.height)))];
    console.log('Available heights:', availableHeights);

    // Define quality options
    const qualities = [
        { height: 2160, quality: '2160p', label: 'MP4 2160p (4K)' },
        { height: 1440, quality: '1440p', label: 'MP4 1440p (2K)' },
        { height: 1080, quality: '1080p', label: 'MP4 1080p (Full HD)' },
        { height: 720, quality: '720p', label: 'MP4 720p (HD)' },
        { height: 480, quality: '480p', label: 'MP4 480p' },
        { height: 360, quality: '360p', label: 'MP4 360p' }
    ];

    // Map qualities to available formats
    const availableFormats = qualities
        .filter(q => availableHeights.includes(q.height))
        .map(q => ({
            quality: q.quality,
            label: q.label,
            available: true
        }));

    // Add audio option
    availableFormats.push({
        quality: 'audio',
        label: 'MP3 (Audio only)',
        available: true
    });

    return availableFormats;
}

// Get video info
app.get('/video-info', async (req, res) => {
    try {
        const videoURL = req.query.url;
        
        if (!videoURL) {
            return res.status(400).json({ error: 'URL parameter is required' });
        }

        if (!ytdl.validateURL(videoURL)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const info = await ytdl.getInfo(videoURL);
        const formats = getAvailableFormats(info.formats);
        
        const videoDetails = {
            title: info.videoDetails.title,
            duration: info.videoDetails.lengthSeconds,
            thumbnail: info.videoDetails.thumbnails[0].url,
            formats: formats
        };
        
        res.json(videoDetails);
    } catch (error) {
        console.error('Error fetching video info:', error);
        res.status(500).json({ 
            error: 'Failed to fetch video information',
            details: error.message 
        });
    }
});

// Download video
app.get('/download', async (req, res) => {
    try {
        const { url, quality } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'URL parameter is required' });
        }

        if (!ytdl.validateURL(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const info = await ytdl.getInfo(url);
        const sanitizedTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '_');

        if (quality === 'audio') {
            try {
                const format = ytdl.chooseFormat(info.formats, { 
                    quality: 'highestaudio',
                    filter: 'audioonly' 
                });
                
                if (!format) {
                    return res.status(400).json({ 
                        error: 'Audio format not available',
                        message: 'Could not find audio format for this video'
                    });
                }

                res.header('Content-Disposition', `attachment; filename="${sanitizedTitle}.mp3"`);
                res.header('Content-Type', 'audio/mpeg');
                ytdl(url, { format }).pipe(res);
            } catch (error) {
                console.error('Audio download error:', error);
                return res.status(500).json({
                    error: 'Audio download failed',
                    message: 'Failed to download audio. Please try again.'
                });
            }
            return;
        }

        // For video downloads
        const requestedHeight = parseInt(quality.replace('p', ''));

        // Get best video format for requested height
        const videoFormats = info.formats.filter(format => {
            return format.container === 'mp4' && 
                   format.hasVideo &&
                   parseInt(format.height) === requestedHeight;
        }).sort((a, b) => parseInt(b.bitrate) - parseInt(a.bitrate));

        // Get best audio format
        const audioFormats = info.formats
            .filter(format => !format.hasVideo && format.hasAudio)
            .sort((a, b) => parseInt(b.audioBitrate || 0) - parseInt(a.audioBitrate || 0));

        if (videoFormats.length === 0) {
            return res.status(400).json({
                error: 'Quality not available',
                message: `${quality} is not available for this video. Please select a different quality.`
            });
        }

        if (audioFormats.length === 0) {
            return res.status(400).json({
                error: 'Audio not available',
                message: 'Could not find audio stream for this video.'
            });
        }

        const videoFormat = videoFormats[0];
        const audioFormat = audioFormats[0];

        console.log('Selected formats:', {
            video: {
                quality: videoFormat.qualityLabel,
                bitrate: videoFormat.bitrate,
                itag: videoFormat.itag
            },
            audio: {
                bitrate: audioFormat.audioBitrate,
                itag: audioFormat.itag
            }
        });

        // Create temporary files
        const tempVideoPath = path.join(tempDir, `${Date.now()}_video.mp4`);
        const tempAudioPath = path.join(tempDir, `${Date.now()}_audio.mp4`);
        const outputPath = path.join(tempDir, `${Date.now()}_output.mp4`);

        try {
            // Download video
            const videoStream = ytdl(url, { format: videoFormat });
            const videoWrite = fs.createWriteStream(tempVideoPath);
            await new Promise((resolve, reject) => {
                videoStream.pipe(videoWrite);
                videoWrite.on('finish', resolve);
                videoWrite.on('error', reject);
            });

            // Download audio
            const audioStream = ytdl(url, { format: audioFormat });
            const audioWrite = fs.createWriteStream(tempAudioPath);
            await new Promise((resolve, reject) => {
                audioStream.pipe(audioWrite);
                audioWrite.on('finish', resolve);
                audioWrite.on('error', reject);
            });

            // Set response headers
            res.header('Content-Disposition', `attachment; filename="${sanitizedTitle}_${videoFormat.qualityLabel}.mp4"`);
            res.header('Content-Type', 'video/mp4');

            // Merge streams using FFmpeg
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(tempVideoPath)
                    .input(tempAudioPath)
                    .outputOptions('-c:v copy')
                    .outputOptions('-c:a aac')
                    .outputOptions('-strict experimental')
                    .output(outputPath)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });

            // Stream the merged file to response
            const readStream = fs.createReadStream(outputPath);
            readStream.pipe(res);

            // Clean up temp files when done
            readStream.on('end', () => {
                fs.unlink(tempVideoPath, () => {});
                fs.unlink(tempAudioPath, () => {});
                fs.unlink(outputPath, () => {});
            });

        } catch (error) {
            console.error('Download error:', error);
            // Clean up temp files on error
            fs.unlink(tempVideoPath, () => {});
            fs.unlink(tempAudioPath, () => {});
            fs.unlink(outputPath, () => {});

            if (!res.headersSent) {
                return res.status(500).json({
                    error: 'Download failed',
                    message: 'Failed to process video. Please try again.'
                });
            }
        }

    } catch (error) {
        console.error('Download error:', error);
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Download failed',
                message: 'An error occurred. Please try again.'
            });
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        details: err.message 
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Make sure to access the application through http://localhost:3000');
}); 