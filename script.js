'use strict';

/* ── 設定 ── */
const OUTPUT_W   = 1080;
const OUTPUT_H   = 1350;
const FRAME_SRC  = 'assets/frame.png';
const FILE_NAME  = 'ajinomotalk-frame-photo.png';

/* ── 状態 ── */
let mediaStream      = null;
let compositeDataUrl = null;

/* ── フレーム画像（先読み） ── */
const frameImage = new Image();
frameImage.src = FRAME_SRC;

/* ── DOM ── */
const video             = document.getElementById('video');
const canvas            = document.getElementById('canvas');
const previewImage      = document.getElementById('preview-image');
const errorMessage      = document.getElementById('error-message');
const processingOverlay = document.getElementById('processing-overlay');

/* ── 画面切り替え ── */
const screens = {
  top:     document.getElementById('screen-top'),
  camera:  document.getElementById('screen-camera'),
  preview: document.getElementById('screen-preview'),
  error:   document.getElementById('screen-error'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  window.scrollTo(0, 0);
}

/* ── イベントバインド ── */
document.getElementById('btn-start')     .addEventListener('click', startCamera);
document.getElementById('btn-back')      .addEventListener('click', stopCamera);
document.getElementById('btn-capture')   .addEventListener('click', capture);
document.getElementById('btn-save')      .addEventListener('click', saveImage);
document.getElementById('btn-retake')    .addEventListener('click', retake);
document.getElementById('btn-top')       .addEventListener('click', goTop);
document.getElementById('btn-error-back').addEventListener('click', goTop);

/* ══════════════════════════════
   カメラ起動
══════════════════════════════ */
async function startCamera() {
  // HTTPSチェック（localhost は除外）
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    showErrorScreen('HTTPSでのアクセスが必要です。URLが「https://」で始まることを確認してください。');
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showErrorScreen('このブラウザはカメラに対応していません。');
    return;
  }

  showScreen('camera');

  try {
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' }, // 背面カメラ優先
        width:  { ideal: 1920 },
        height: { ideal: 1440 },
      },
      audio: false,
    };
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = mediaStream;
    await video.play();
  } catch (err) {
    stopStreamTracks();
    showScreen('error');
    errorMessage.textContent = cameraErrorMessage(err);
  }
}

function stopStreamTracks() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  video.srcObject = null;
}

function stopCamera() {
  stopStreamTracks();
  showScreen('top');
}

function cameraErrorMessage(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'カメラの使用が許可されていません。ブラウザの設定から許可してください。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'カメラが見つかりませんでした。端末にカメラが搭載されているか確認してください。';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '他のアプリがカメラを使用中の可能性があります。他のアプリを閉じてから再度お試しください。';
  }
  if (name === 'OverconstrainedError') {
    return 'カメラの設定が端末に対応していませんでした。';
  }
  return `カメラを起動できませんでした。(${name || 'Unknown'})`;
}

function showErrorScreen(message) {
  errorMessage.textContent = message;
  showScreen('error');
}

/* ══════════════════════════════
   撮影・画像合成

   重要：
   - camera-view は aspect-ratio: 4/5 で表示
   - video / frame-overlay は object-fit: cover で camera-view を充填
   - canvas も同じ 4:5 クロップで合成
   → プレビューと保存画像が一致する
══════════════════════════════ */
async function capture() {
  if (!mediaStream) return;

  setProcessing(true);

  try {
    // フレーム画像の読み込み待ち（未完了の場合）
    if (!frameImage.complete || frameImage.naturalWidth === 0) {
      await new Promise((resolve, reject) => {
        frameImage.onload  = resolve;
        frameImage.onerror = reject;
        setTimeout(reject, 5000); // 5秒タイムアウト
      }).catch(() => null); // フレーム未読み込みでも続行
    }

    canvas.width  = OUTPUT_W;
    canvas.height = OUTPUT_H;
    const ctx = canvas.getContext('2d');

    // ① video映像を object-fit: cover と同じクロップでCanvasに描画
    drawVideoCover(ctx, video, OUTPUT_W, OUTPUT_H);

    // ② フレームを重ねる
    if (frameImage.naturalWidth > 0) {
      ctx.drawImage(frameImage, 0, 0, OUTPUT_W, OUTPUT_H);
    }

    compositeDataUrl = canvas.toDataURL('image/png');
    previewImage.src = compositeDataUrl;

    stopStreamTracks();
    showScreen('preview');
  } catch (err) {
    console.error('合成エラー:', err);
    alert('画像の合成に失敗しました。もう一度お試しください。');
  } finally {
    setProcessing(false);
  }
}

/**
 * video要素の映像を「object-fit: cover」と同じクロップでCanvasに描く。
 * targetW/targetH のアスペクト比に合わせて中央クロップ。
 */
function drawVideoCover(ctx, videoEl, targetW, targetH) {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;

  if (!vw || !vh) return;

  const videoAspect  = vw / vh;
  const targetAspect = targetW / targetH;

  let sx, sy, sWidth, sHeight;

  if (videoAspect > targetAspect) {
    // 動画がターゲットより横長 → 左右をクロップ
    sHeight = vh;
    sWidth  = vh * targetAspect;
    sx = (vw - sWidth) / 2;
    sy = 0;
  } else {
    // 動画がターゲットより縦長 → 上下をクロップ
    sWidth  = vw;
    sHeight = vw / targetAspect;
    sx = 0;
    sy = (vh - sHeight) / 2;
  }

  ctx.drawImage(videoEl, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH);
}

/* ══════════════════════════════
   保存
   優先順位：
   1. Web Share API（iOS15+ / Android）→ ネイティブ共有シート
   2. <a download>（Android Chrome等）
   3. フォールバック：プレビュー画像を長押し案内
══════════════════════════════ */
async function saveImage() {
  if (!compositeDataUrl) return;

  const blob = dataUrlToBlob(compositeDataUrl);

  // ① Web Share API（ファイル共有対応）
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], FILE_NAME, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // ユーザーがキャンセル
        // エラーの場合は次の方法へ
      }
    }
  }

  // ② <a download>（Android Chrome等）
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
             || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (!isIOS) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href     = blobUrl;
    a.download = FILE_NAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    return;
  }

  // ③ iOS フォールバック：プレビュー画像を長押し案内
  showSaveHintIOS();
}

function showSaveHintIOS() {
  const hint = document.getElementById('ios-save-hint');
  if (hint) {
    hint.classList.remove('hidden');
    hint.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime   = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/* ══════════════════════════════
   撮り直し / トップへ戻る
══════════════════════════════ */
async function retake() {
  compositeDataUrl = null;
  previewImage.src = '';
  await startCamera();
}

function goTop() {
  stopStreamTracks();
  compositeDataUrl = null;
  previewImage.src = '';
  showScreen('top');
}

/* ══════════════════════════════
   UI ヘルパー
══════════════════════════════ */
function setProcessing(on) {
  processingOverlay.classList.toggle('hidden', !on);
}
