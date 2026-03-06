/**
 * studio-bridge.ts — TypeScript Promise-based client for the DC ↔ ComfyUI postMessage bridge.
 *
 * Usage:
 *   studioBridge.connect(iframeEl, comfyUrl);
 *   await studioBridge.send('add-node', { nodeType: 'CheckpointLoaderSimple', inputName: 'ckpt_name', modelFilename: 'model.safetensors' });
 *   studioBridge.on('graph-ready', handler);
 *   studioBridge.disconnect();
 */

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const MODEL_NODE_MAP: Record<string, { nodeType: string; inputName: string }> = {
  checkpoints:      { nodeType: 'CheckpointLoaderSimple', inputName: 'ckpt_name' },
  unet:             { nodeType: 'UNETLoader',              inputName: 'unet_name' },
  diffusion_models: { nodeType: 'UNETLoader',              inputName: 'unet_name' },
  loras:            { nodeType: 'LoraLoader',              inputName: 'lora_name' },
  controlnet:       { nodeType: 'ControlNetLoader',        inputName: 'control_net_name' },
  vae:              { nodeType: 'VAELoader',               inputName: 'vae_name' },
  clip:             { nodeType: 'CLIPLoader',              inputName: 'clip_name' },
  clip_vision:      { nodeType: 'CLIPVisionLoader',        inputName: 'clip_name' },
  upscale_models:   { nodeType: 'UpscaleModelLoader',      inputName: 'model_name' },
};

type BridgeEventHandler = (payload: unknown) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

class StudioBridge {
  private iframe: HTMLIFrameElement | null = null;
  private pending: Map<string, PendingRequest> = new Map();
  private handlers: Map<string, Set<BridgeEventHandler>> = new Map();
  private boundListener: ((event: MessageEvent) => void) | null = null;

  connect(iframe: HTMLIFrameElement, _comfyUrl: string): void {
    if (this.boundListener) {
      window.removeEventListener('message', this.boundListener);
    }
    this.iframe = iframe;
    this.boundListener = this.handleMessage.bind(this);
    window.addEventListener('message', this.boundListener);
  }

  disconnect(): void {
    if (this.boundListener) {
      window.removeEventListener('message', this.boundListener);
      this.boundListener = null;
    }
    // Reject all pending
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Bridge disconnected'));
    }
    this.pending.clear();
    this.iframe = null;
  }

  send<T = unknown>(type: string, payload?: unknown, timeoutMs = 10000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.iframe?.contentWindow) {
        reject(new Error('Bridge not connected'));
        return;
      }
      const messageId = generateId();
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error(`Bridge command "${type}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(messageId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.iframe.contentWindow.postMessage(
        { source: 'dc-studio', type, payload: payload ?? {}, messageId },
        '*'
      );
    });
  }

  on(event: string, handler: BridgeEventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: BridgeEventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  private handleMessage(event: MessageEvent): void {
    const msg = event.data as { source?: string; type?: string; payload?: unknown; messageId?: string };
    if (!msg || msg.source !== 'dc-bridge') return;

    const { type, payload, messageId } = msg;

    if (type === 'response' && messageId) {
      const pending = this.pending.get(messageId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(messageId);
        const p = payload as { messageId?: string; result?: unknown; error?: string | null };
        if (p?.error) {
          pending.reject(new Error(p.error));
        } else {
          pending.resolve(p?.result);
        }
      }
      return;
    }

    // Broadcast event to registered handlers
    const set = this.handlers.get(type ?? '');
    if (set) {
      for (const handler of set) {
        try { handler(payload); } catch { /* ignore handler errors */ }
      }
    }
  }
}

export const studioBridge = new StudioBridge();
