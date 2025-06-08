/**
 * Video List Configuration */

// List of available media (videos and images)
const availableMedia = [
  'jigoku.mp4',
  'static-long.mp4',
  'virgin2.mp4',
];

// Function to get a random media file from the list
function getRandomMedia() {
  const randomIndex = Math.floor(Math.random() * availableMedia.length);
  return 'assets/media/' + availableMedia[randomIndex];
} 