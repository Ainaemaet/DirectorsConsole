/**
 * dc_bridge.js — Director's Console ↔ ComfyUI postMessage bridge extension.
 *
 * Loaded automatically by ComfyUI when ComfyCinemaPrompting is installed.
 * Only activates when ComfyUI is running inside DC's Studio iframe
 * (detected via window.self !== window.top).
 *
 * Protocol:
 *   DC → Bridge: { source: 'dc-studio', type, payload, messageId }
 *   Bridge → DC: { source: 'dc-bridge', type, payload, messageId }
 */

import { app } from "/scripts/app.js";

const isEmbedded = window.self !== window.top;

if (isEmbedded) {
  const MODEL_NODE_MAP = {
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

  function sendToParent(type, payload, messageId) {
    window.parent.postMessage({ source: 'dc-bridge', type, payload, messageId }, '*');
  }

  function sendResponse(messageId, result, error) {
    sendToParent('response', { messageId, result, error }, messageId);
  }

  /**
   * Convert DC API-format workflow dict to LiteGraph graph object.
   * If the payload already has a .nodes array it is already LiteGraph format — pass through.
   */
  function apiFormatToLiteGraph(workflow) {
    if (Array.isArray(workflow.nodes)) {
      return workflow;
    }

    const GRID_COLS = 4;
    const NODE_W = 220;
    const NODE_H = 160;
    const GAP_X = 40;
    const GAP_Y = 40;

    const nodes = [];
    const links = [];
    let linkId = 1;
    const nodeIndex = {};

    const entries = Object.entries(workflow);

    entries.forEach(([id, nodeData], idx) => {
      const col = idx % GRID_COLS;
      const row = Math.floor(idx / GRID_COLS);
      const x = col * (NODE_W + GAP_X);
      const y = row * (NODE_H + GAP_Y);

      const inputs = nodeData.inputs || {};
      const widgetValues = [];
      const nodeInputs = [];
      const nodeOutputs = [{ name: 'output', type: '*', links: [] }];

      Object.entries(inputs).forEach(([inputName, value]) => {
        if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number') {
          // Connection: ["srcNodeId", slotIdx]
          const [srcId, slotIdx] = value;
          const lid = linkId++;
          links.push([lid, String(srcId), slotIdx, id, nodeInputs.length, '*']);
          nodeInputs.push({ name: inputName, type: '*', link: lid });
        } else {
          // Scalar widget value
          widgetValues.push(value);
          nodeInputs.push({ name: inputName, type: '*', widget: { name: inputName } });
        }
      });

      const lgNode = {
        id: parseInt(id, 10) || id,
        type: nodeData.class_type,
        pos: [x, y],
        size: [NODE_W, NODE_H],
        flags: {},
        order: idx,
        mode: 0,
        inputs: nodeInputs,
        outputs: nodeOutputs,
        properties: {},
        widgets_values: widgetValues,
      };

      nodes.push(lgNode);
      nodeIndex[id] = lgNode;
    });

    return {
      last_node_id: nodes.length,
      last_link_id: linkId - 1,
      nodes,
      links,
      groups: [],
      config: {},
      extra: {},
      version: 0.4,
    };
  }

  let workflowChangedTimer = null;

  function onGraphChanged() {
    clearTimeout(workflowChangedTimer);
    workflowChangedTimer = setTimeout(() => {
      sendToParent('workflow-changed', {}, null);
    }, 500);
  }

  app.registerExtension({
    name: 'DC.Bridge',

    async setup() {
      console.log('[DC Bridge] Embedded mode detected — bridge active');

      // Notify DC that bridge is ready
      sendToParent('graph-ready', { version: '1.0' }, null);

      // Listen for graph changes
      const origAfterChange = app.graph?.afterChange?.bind(app.graph);
      if (app.graph) {
        app.graph.afterChange = (...args) => {
          origAfterChange?.(...args);
          onGraphChanged();
        };
      }

      // Handle commands from DC
      window.addEventListener('message', async (event) => {
        const msg = event.data;
        if (!msg || msg.source !== 'dc-studio') return;

        const { type, payload, messageId } = msg;

        try {
          switch (type) {
            case 'load-workflow': {
              const lgData = apiFormatToLiteGraph(payload.workflow);
              app.loadGraphData(lgData);
              sendResponse(messageId, { ok: true }, null);
              break;
            }

            case 'get-workflow': {
              const result = await app.graphToPrompt();
              sendResponse(messageId, {
                apiFormat: result.output,
                graphFormat: result.workflow,
              }, null);
              break;
            }

            case 'add-node': {
              const { nodeType, inputName, modelFilename } = payload;
              const node = LiteGraph.createNode(nodeType);
              if (!node) {
                sendResponse(messageId, null, `Unknown node type: ${nodeType}`);
                break;
              }

              // Place at canvas center
              const canvas = app.canvas;
              const cx = canvas.canvas.width / 2;
              const cy = canvas.canvas.height / 2;
              const [wx, wy] = canvas.convertOffsetToCanvas([cx, cy]);
              node.pos = [wx - node.size[0] / 2, wy - node.size[1] / 2];

              if (inputName && modelFilename) {
                const widget = node.widgets?.find(w => w.name === inputName);
                if (widget) widget.value = modelFilename;
              }

              app.graph.add(node);
              app.graph.setDirtyCanvas(true, true);
              sendResponse(messageId, { ok: true, nodeId: node.id }, null);
              break;
            }

            case 'replace-model': {
              const { nodeType, inputName, modelFilename } = payload;
              // Find an existing node of this type and update its widget
              const existing = app.graph._nodes?.find(n => n.type === nodeType);
              if (existing) {
                const widget = existing.widgets?.find(w => w.name === inputName);
                if (widget) {
                  widget.value = modelFilename;
                  app.graph.setDirtyCanvas(true, true);
                  sendResponse(messageId, { ok: true, replaced: true, nodeId: existing.id }, null);
                  break;
                }
              }
              // No existing node — fall back to add
              const node = LiteGraph.createNode(nodeType);
              if (!node) {
                sendResponse(messageId, null, `Unknown node type: ${nodeType}`);
                break;
              }
              const canvas = app.canvas;
              const cx = canvas.canvas.width / 2;
              const cy = canvas.canvas.height / 2;
              const [wx, wy] = canvas.convertOffsetToCanvas([cx, cy]);
              node.pos = [wx - node.size[0] / 2, wy - node.size[1] / 2];
              const widget = node.widgets?.find(w => w.name === inputName);
              if (widget) widget.value = modelFilename;
              app.graph.add(node);
              app.graph.setDirtyCanvas(true, true);
              sendResponse(messageId, { ok: true, replaced: false, nodeId: node.id }, null);
              break;
            }

            case 'fit-view': {
              app.canvas.zoomToFit();
              sendResponse(messageId, { ok: true }, null);
              break;
            }

            case 'ping': {
              sendResponse(messageId, { version: '1.0', ready: true }, null);
              break;
            }

            default:
              sendResponse(messageId, null, `Unknown command: ${type}`);
          }
        } catch (err) {
          console.error('[DC Bridge] Error handling command', type, err);
          sendResponse(messageId, null, String(err));
        }
      });
    },
  });

  // Export map for completeness (not used by ComfyUI itself)
  window.__dc_bridge_MODEL_NODE_MAP = MODEL_NODE_MAP;
}
