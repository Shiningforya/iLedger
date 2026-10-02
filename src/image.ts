const acceptedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

function sanitizeSvg(text: string) {
  const documentNode = new DOMParser().parseFromString(text, "image/svg+xml");
  documentNode.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((node) => node.remove());
  documentNode.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (/^on/i.test(attribute.name) || /javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
    });
  });
  return new XMLSerializer().serializeToString(documentNode.documentElement);
}

export async function compressCategoryIcon(file: File) {
  if (!acceptedTypes.has(file.type)) throw new Error("请选择 PNG、JPG、WebP 或 SVG 图片");
  if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过 8 MB");
  const sourceBlob = file.type === "image/svg+xml"
    ? new Blob([sanitizeSvg(await file.text())], { type: "image/svg+xml" })
    : file;
  const url = URL.createObjectURL(sourceBlob);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("图片无法读取"));
      image.src = url;
    });
    const maxSide = 160;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
