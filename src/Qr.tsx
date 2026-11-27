// Show a code as a QR, or read one with the camera. Both work offline.
import { useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';

export const QR_MAX = 2900;

export function QrCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  let svg = '';
  if (code.length <= QR_MAX) {
    const q = qrcode(0, 'L');
    q.addData(code, 'Byte');
    q.make();
    svg = q.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
  }
  return (
    <>
      {svg
        ? <div style={{ background: '#fff', borderRadius: 10, maxWidth: 420, margin: '12px auto' }} role="img" aria-label="QR code" dangerouslySetInnerHTML={{ __html: svg }} />
        : <div className="note">This is too big for one QR code. Copy the code and send it as a message instead.</div>}
      <p className="muted small">{code.length} characters{svg && code.length > 1200 ? ' · dense code: turn the screen brightness up' : ''}</p>
      <button className="small-btn" onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? 'Copied' : 'Copy code'}</button>
    </>
  );
}

export function Scanner({ label, onCode }: { label: string; onCode: (code: string) => void }) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const found = useRef(onCode);
  found.current = onCode;

  useEffect(() => {
    if (!on) return;
    let live = true, timer = 0;
    let stream: MediaStream | undefined;
    const canvas = document.createElement('canvas');
    const tick = () => {
      if (!live) return;
      const v = video.current;
      if (v && v.videoWidth) {
        const k = Math.min(1, 1000 / v.videoWidth);
        canvas.width = v.videoWidth * k; canvas.height = v.videoHeight * k;
        const g = canvas.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = g.getImageData(0, 0, canvas.width, canvas.height);
        const hit = jsQR(img.data, img.width, img.height);
        if (hit?.data.startsWith('CDC1.')) { setOn(false); found.current(hit.data); return; }
      }
      timer = window.setTimeout(tick, 150);
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } });
        if (!live) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        tick();
      } catch { if (live) { setError('The camera isn’t available. Allow camera access, or paste the code below.'); setOn(false); } }
    })();
    return () => { live = false; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [on]);

  return (
    <>
      <div className="row-btns"><button className="primary" style={{ marginTop: 0 }} onClick={() => { setError(''); setOn(!on); }}>{on ? 'Stop camera' : label}</button></div>
      {on && <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 10, marginTop: 8 }} />}
      {error && <div className="note">{error}</div>}
      <details className="dd">
        <summary>Paste a code instead</summary>
        <div className="ddbody">
          <textarea rows={3} style={{ width: '100%' }} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="CDC1.…" />
          <button className="small-btn" disabled={!typed.trim()} onClick={() => { onCode(typed); setTyped(''); }}>Use code</button>
        </div>
      </details>
    </>
  );
}
