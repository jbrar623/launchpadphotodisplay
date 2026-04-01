// IIE Photo Display — configuration
// Edit these values to control display behaviour.


const config = {
  photowall: {
    // How often (ms) to poll Google Drive for newly uploaded photos.
    // New photos will appear on screen within this interval.
    // Default: 30 seconds.
    refreshRate: 30 * 1000,

    // How long (ms) each photo is shown before advancing to the next.
    // Default: 6 seconds.
    rotationRate: 6 * 1000,
  },

  display: {
    // Text shown on the QR card heading.
    qrHeading: "Scan to add your photos!",

    // Subtext shown beneath the QR heading.
    qrSubtext: "Scan the QR code to upload your photos to the display",
  },

  upload: {
    // Maximum file size allowed per upload (MB).
    maxFileSizeMB: 20,

    // Allowed image MIME types.
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic'],

    // Title shown on the upload page.
    pageTitle: "Share Your Photos",

    // Subtitle shown on the upload page.
    pageSubtitle: "Upload your photos and watch them appear on the display!",
  },
};

module.exports = config;