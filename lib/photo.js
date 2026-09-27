// Reads an image file and returns it as base64 JPEG, resized down to a
// passport-photo-ish size — plenty to recognise someone, a fraction of a raw
// phone photo. Same approach as the student photo on /students/[id].
// maxDim and quality are raised for pictures that need detail (a behaviour
// event's photo uses 800px at 0.6).
export async function resizePhotoToBase64(file, maxDim = 400, quality = 0.82) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}
