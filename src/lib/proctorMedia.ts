/**
 * Global holder for the webcam MediaStream captured in the waiting room.
 *
 * router state cannot carry a live MediaStream between pages, so we keep a
 * module-level singleton. deviceId is mirrored to sessionStorage so a page
 * refresh can reopen the same physical camera.
 */

const DEVICE_KEY = 'proctor_webcam_device_id';

let heldStream: MediaStream | null = null;
let heldDeviceId = '';

export function setProctorWebcam(stream: MediaStream | null, deviceId: string) {
  heldStream = stream;
  heldDeviceId = deviceId || '';
  try {
    if (heldDeviceId) sessionStorage.setItem(DEVICE_KEY, heldDeviceId);
  } catch { /* ignore */ }
}

export function getProctorWebcam(): { stream: MediaStream | null; deviceId: string } {
  let deviceId = heldDeviceId;
  if (!deviceId) {
    try { deviceId = sessionStorage.getItem(DEVICE_KEY) || ''; } catch { /* ignore */ }
  }
  return { stream: heldStream, deviceId };
}

export function releaseProctorWebcam() {
  try { heldStream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
  heldStream = null;
  heldDeviceId = '';
  try { sessionStorage.removeItem(DEVICE_KEY); } catch { /* ignore */ }
}
