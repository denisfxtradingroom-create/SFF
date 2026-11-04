/* SFF profile photo editor: crop once before upload, no server state or polling. */
(() => {
  "use strict";
  const WIDTH = { avatar: 512, banner: 1200 };
  const HEIGHT = { avatar: 512, banner: 400 };
  const maxUploadBytes = 1024000;
  const loadImage = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(Error("Slika ne može da se otvori.")); };
    img.src = url;
  });
  const exportBlob = (canvas, quality) => new Promise((resolve, reject) =>
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(Error("Obrada slike nije uspela.")),
      "image/jpeg", quality));
  const asBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("Čitanje slike nije uspelo."));
    reader.readAsDataURL(blob);
  });

  window.SFFCropImage = async function cropImage(file, slot) {
    if (!["avatar", "banner"].includes(slot)) throw Error("Nepoznata vrsta fotografije.");
    if (!["image/png", "image/jpeg"].includes(file?.type) || file.size > 12 * 1024 * 1024)
      throw Error("Izaberi JPG ili PNG fotografiju do 12 MB.");
    const img = await loadImage(file);
    if (!img.naturalWidth || !img.naturalHeight) throw Error("Neispravna fotografija.");
    const w = WIDTH[slot], h = HEIGHT[slot];
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.setAttribute("aria-label", "Pregled izabranog kadra");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Uređaj ne podržava obradu fotografija.");
    let zoom = 1, offX = 0, offY = 0;
    const minScale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const draw = () => {
      const rw = img.naturalWidth * minScale * zoom;
      const rh = img.naturalHeight * minScale * zoom;
      offX = Math.max(-(rw - w) / 2, Math.min((rw - w) / 2, offX));
      offY = Math.max(-(rh - h) / 2, Math.min((rh - h) / 2, offY));
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, (w - rw) / 2 + offX, (h - rh) / 2 + offY, rw, rh);
    };
    draw();
    const dialog = document.createElement("dialog");
    dialog.className = "sffImageCropDialog";
    dialog.setAttribute("aria-label", "Podesi kadar fotografije");
    dialog.innerHTML =
      '<div class="sffCropContent"><h2>' +
      (slot === "banner" ? "Podesi naslovnu fotografiju" : "Podesi profilnu fotografiju") +
      '</h2><p>Prevuci sliku da odrediš šta se vidi. Zumiraj po želji.</p>' +
      '<div class="sffCropCanvasWrap"></div>' +
      '<label class="sffCropZoom">Zumiranje <input type="range" min="100" max="300" value="100" step="1"></label>' +
      '<div class="sffCropActions"><button type="button" data-crop-cancel>Otkaži</button>' +
      '<button type="button" data-crop-save class="sffV5Primary">Sačuvaj fotografiju</button></div></div>';
    dialog.querySelector(".sffCropCanvasWrap").append(canvas);
    document.body.append(dialog);
    const slider = dialog.querySelector('input[type="range"]');
    slider.addEventListener("input", () => { zoom = Number(slider.value) / 100; draw(); });
    let pointer = null;
    canvas.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const rect = canvas.getBoundingClientRect();
      offX += (event.clientX - pointer.x) * (w / rect.width);
      offY += (event.clientY - pointer.y) * (h / rect.height);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      draw();
    });
    const release = () => { pointer = null; };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("lostpointercapture", release);
    return new Promise((resolve, reject) => {
      let finished = false;
      const done = (value, error) => {
        if (finished) return;
        finished = true;
        dialog.close();
        dialog.remove();
        if (error) reject(error); else resolve(value);
      };
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); done(null); });
      dialog.querySelector("[data-crop-cancel]").addEventListener("click", () => done(null));
      dialog.querySelector("[data-crop-save]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          let blob = null;
          for (const quality of [0.89, 0.80, 0.68, 0.54]) {
            blob = await exportBlob(canvas, quality);
            if (blob.size <= maxUploadBytes) break;
          }
          if (!blob || blob.size > maxUploadBytes)
            throw Error("Fotografija je prevelika i nakon obrade.");
          done(await asBase64(blob));
        } catch (error) {
          button.disabled = false;
          dialog.querySelector("p").textContent = error.message;
        }
      });
      try { dialog.showModal(); }
      catch (error) { done(null, error); }
    });
  };
})();
