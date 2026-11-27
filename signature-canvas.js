export function attachSignaturePad(canvas, { initial = "", onChange = () => {} } = {}) {
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  let width = 0, height = 0, current = initial, generation = 0;
  let drawing = false;
  const configure = () => {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.strokeStyle = "#18334a";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
  };
  const resize = () => {
    const nextWidth = canvas.clientWidth, nextHeight = canvas.clientHeight;
    if (!nextWidth || !nextHeight || drawing || (nextWidth === width && nextHeight === height)) return;
    width = nextWidth; height = nextHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    configure();
    const token = ++generation;
    if (!current) return;
    const image = new Image();
    image.onload = () => { if (token === generation && !drawing) context.drawImage(image, 0, 0, width, height); };
    image.src = current;
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    if (!canvas.isConnected) { observer.disconnect(); return; }
    resize();
  }) : null;
  observer?.observe(canvas);
  resize();
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * width / (rect.width || width), y: (event.clientY - rect.top) * height / (rect.height || height) };
  };
  canvas.addEventListener("pointerdown", (event) => {
    resize();
    if (!width || !height) return;
    drawing = true;
    ++generation;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Some touch browsers decline capture. */ }
    const p = point(event);
    context.beginPath();
    context.moveTo(p.x, p.y);
    context.lineTo(p.x + 0.1, p.y + 0.1);
    context.stroke();
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const p = point(event);
    context.lineTo(p.x, p.y);
    context.stroke();
    event.preventDefault();
  });
  const finish = () => {
    if (!drawing) return;
    drawing = false;
    current = canvas.toDataURL("image/png");
    ++generation;
    onChange(current);
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("lostpointercapture", finish);
  return () => {
    current = "";
    ++generation;
    context.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };
}
