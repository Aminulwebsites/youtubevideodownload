document.addEventListener('DOMContentLoaded', () => {
    const videoUrlInput = document.getElementById('videoUrl');
    const startBtn = document.getElementById('startBtn');
    const videoInfo = document.getElementById('videoInfo');
    const downloadOptions = document.getElementById('downloadOptions');
    const thumbnail = document.getElementById('thumbnail');
    const videoTitle = document.getElementById('videoTitle');
    const videoDuration = document.getElementById('videoDuration');
    const errorMessage = document.getElementById('errorMessage');
    const downloadButtons = document.querySelectorAll('.download-btn');

    // Function to show error message
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        videoInfo.style.display = 'none';
        downloadOptions.style.display = 'none';
    }

    // Function to hide error message
    function hideError() {
        errorMessage.style.display = 'none';
    }

    // Function to show loading state
    function setLoading(isLoading) {
        if (isLoading) {
            startBtn.innerHTML = '<span class="loading"></span>Processing...';
            startBtn.disabled = true;
        } else {
            startBtn.innerHTML = 'Start';
            startBtn.disabled = false;
        }
    }

    // Function to reset download buttons
    function resetDownloadButtons() {
        downloadButtons.forEach(button => {
            button.disabled = true;
            button.classList.remove('available');
        });
    }

    // Function to enable available formats
    function enableAvailableFormats(formats) {
        // First disable all buttons
        resetDownloadButtons();

        // Enable buttons for available formats
        formats.forEach(format => {
            const button = document.querySelector(`button[data-quality="${format.quality}"]`);
            if (button) {
                button.disabled = false;
                button.classList.add('available');
            }
        });
    }

    // Add click handlers to download buttons
    downloadButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (!button.disabled) {
                handleDownload(button.dataset.quality);
            }
        });
    });

    startBtn.addEventListener('click', async () => {
        const url = videoUrlInput.value.trim();
        
        if (!url) {
            showError('Please enter a YouTube URL');
            return;
        }

        // Hide any previous error messages
        hideError();

        // Show loading state
        setLoading(true);

        try {
            // Fetch video information
            const response = await fetch(`/video-info?url=${encodeURIComponent(url)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to fetch video information');
            }

            if (!data.formats || data.formats.length === 0) {
                throw new Error('No download formats available for this video');
            }

            // Display video information
            videoInfo.style.display = 'flex';
            downloadOptions.style.display = 'block';
            
            // Set video data
            videoTitle.textContent = data.title;
            videoDuration.textContent = `Duration: ${formatDuration(data.duration)}`;
            thumbnail.src = data.thumbnail;

            // Enable available download options
            enableAvailableFormats(data.formats);
            
        } catch (error) {
            console.error('Error:', error);
            showError(error.message || 'Failed to fetch video information. Please check the URL and try again.');
        } finally {
            setLoading(false);
        }
    });

    // Handle Enter key in input
    videoUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            startBtn.click();
        }
    });
});

// Function to handle download
async function handleDownload(quality) {
    try {
        const url = document.getElementById('videoUrl').value.trim();
        if (!url) {
            throw new Error('Please enter a YouTube URL first');
        }

        const format = quality === 'audio' ? 'mp3' : 'mp4';
        const downloadUrl = `/download?url=${encodeURIComponent(url)}&format=${format}&quality=${quality}`;
        
        // Create a temporary link and click it to start the download
        const link = document.createElement('a');
        link.href = downloadUrl;
        
        // Add timestamp to prevent caching
        link.href += `&t=${Date.now()}`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('Download error:', error);
        // Access the error message element directly since we're outside the DOMContentLoaded scope
        const errorMessage = document.getElementById('errorMessage');
        errorMessage.textContent = error.message || 'Failed to start download. Please try again.';
        errorMessage.style.display = 'block';
    }
}

// Helper function to format duration
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
        return `${hours}:${padZero(minutes)}:${padZero(remainingSeconds)}`;
    }
    return `${minutes}:${padZero(remainingSeconds)}`;
}

function padZero(num) {
    return num.toString().padStart(2, '0');
} 