// Shared by every PDF generator that stamps the school logo on the page.
export async function loadLogoBase64() {
  const res = await fetch('/logo.png');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
