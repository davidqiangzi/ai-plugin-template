"use client";

import { figmaAPI } from "@/lib/figmaAPI";
import { CompletionRequestBody } from "@/lib/types";
import { useState } from "react";
import { z } from "zod";

async function streamAIResponse(body: z.infer<typeof CompletionRequestBody>) {
  const resp = await fetch("/api/completion", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const reader = resp.body?.pipeThrough(new TextDecoderStream()).getReader();

  if (!reader) {
    throw new Error("Error reading response");
  }

  return reader;
}

export default function Plugin() {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [debugText, setDebugText] = useState("");

  const onGenerateDesign = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setDebugText("");

    try {
      const reader = await streamAIResponse({ prompt });

      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        text += value;
        setDebugText(text); // Show streaming JSON for debug
      }

      // Now we have the full JSON, let's parse it and send to Figma canvas
      const drawInFigma = async () => {
        await figmaAPI.run(
          async (figma, { jsonStr }) => {
            let data;
            try {
              // Sometimes the AI might wrap JSON in ```json ... ```, let's clean it up
              let cleanStr = jsonStr.trim();
              if (cleanStr.startsWith("```json")) {
                cleanStr = cleanStr.replace(/^```json/, "").replace(/```$/, "").trim();
              } else if (cleanStr.startsWith("```")) {
                cleanStr = cleanStr.replace(/^```/, "").replace(/```$/, "").trim();
              }

              // Try parsing directly first
              try {
                data = JSON.parse(cleanStr);
              } catch (parseErr) {
                // JSON is likely truncated — try to repair it
                console.log("JSON parse failed, attempting auto-repair...");

                let repaired = cleanStr;

                // Step 1: Remove trailing incomplete string (unclosed quote)
                // Count quotes to see if we're inside a string
                let quoteCount = 0;
                for (let i = 0; i < repaired.length; i++) {
                  if (repaired[i] === '"' && (i === 0 || repaired.charCodeAt(i-1) !== 92)) {
                    quoteCount++;
                  }
                }
                if (quoteCount % 2 !== 0) {
                  // Odd number of quotes = unclosed string, close it
                  repaired += '"';
                }

                // Step 2: Remove trailing incomplete key-value patterns
                // e.g. ,"key":"val  or  ,"key":123  or  ,"key":tr
                repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*(?:"[^"]*)?$/, "");
                repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*(?:true|false|null|[\d.+-]*)?\s*$/, "");
                repaired = repaired.replace(/,\s*"[^"]*"\s*:?\s*$/, "");
                repaired = repaired.replace(/,\s*$/, "");

                // Step 3: Count unclosed brackets and braces (outside strings)
                const stack: string[] = [];
                let inStr = false;
                for (let i = 0; i < repaired.length; i++) {
                  const c = repaired[i];
                  if (c.charCodeAt(0) === 92 && inStr) { i++; continue; } // skip escaped char (backslash)
                  if (c === '"') { inStr = !inStr; continue; }
                  if (inStr) continue;
                  if (c === '{' || c === '[') stack.push(c);
                  if (c === '}' || c === ']') stack.pop();
                }

                // Step 4: Close in reverse order (maintains valid nesting)
                while (stack.length > 0) {
                  const open = stack.pop();
                  repaired += (open === '{') ? '}' : ']';
                }

                data = JSON.parse(repaired);
                figma.notify("AI 输出被截断，已自动修复并渲染可用部分", { timeout: 4000 });
              }
            } catch (e) {
              figma.notify("无法解析 AI 返回的 JSON 数据", { error: true });
              return;
            }

            const hexToRgb = (hex: string) => {
              const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
              return result
                ? {
                    r: parseInt(result[1], 16) / 255,
                    g: parseInt(result[2], 16) / 255,
                    b: parseInt(result[3], 16) / 255,
                  }
                : { r: 1, g: 1, b: 1 };
            };

            await figma.loadFontAsync({ family: "Inter", style: "Regular" });
            await figma.loadFontAsync({ family: "Inter", style: "Medium" });
            await figma.loadFontAsync({ family: "Inter", style: "Bold" });

            // ===== Helper functions =====
            const applyHighFidelityProps = (n: any, data: any) => {
              if (typeof data.opacity === 'number' && 'opacity' in n) {
                n.opacity = data.opacity;
              }
              if (data.stroke && 'strokes' in n) {
                n.strokes = [{ type: "SOLID", color: hexToRgb(data.stroke.color) }];
                if (typeof data.stroke.weight === 'number' && 'strokeWeight' in n) {
                  n.strokeWeight = data.stroke.weight;
                }
              }
              if (data.dropShadow && 'effects' in n) {
                n.effects = [{
                  type: "DROP_SHADOW",
                  color: { ...hexToRgb(data.dropShadow.color), a: data.dropShadow.opacity ?? 0.25 },
                  offset: { x: data.dropShadow.x || 0, y: data.dropShadow.y || 4 },
                  radius: data.dropShadow.blur || 4,
                  visible: true,
                  blendMode: "NORMAL",
                }];
              }
            };

            const sanitizeLayoutMode = (mode: any): string | null => {
              if (!mode || typeof mode !== 'string') return null;
              const m = mode.toUpperCase();
              if (m.includes("HORIZ") || m === "ROW") return "HORIZONTAL";
              if (m.includes("VERT") || m === "COL" || m === "COLUMN") return "VERTICAL";
              return null; // treat NONE / unknown as null
            };

            const sanitizeAlign = (align: any): string => {
              if (!align || typeof align !== 'string') return "MIN";
              const a = align.toUpperCase();
              if (a.includes("CENTER") || a.includes("MIDDLE")) return "CENTER";
              if (a.includes("END") || a.includes("RIGHT") || a.includes("BOTTOM")) return "MAX";
              if (a.includes("BETWEEN") || a.includes("AROUND") || a.includes("EVENLY")) return "SPACE_BETWEEN";
              return "MIN";
            };

            const sanitizeSizing = (sizing: any): string | null => {
              if (!sizing || typeof sizing !== 'string') return null;
              const s = sizing.toUpperCase();
              if (s.includes("FIX")) return "FIXED";
              if (s.includes("FILL") || s.includes("EXPAND") || s.includes("STRETCH")) return "FILL";
              if (s.includes("HUG")) return "HUG";
              return null;
            };

            // ===== Core recursive node builder =====
            // Returns { node, layoutMode } so parent knows how to configure child sizing
            const createNode = (nodeData: any, isRoot = false): SceneNode | null => {
              try {
                let node: SceneNode;

                switch (nodeData.type) {
                  case "FRAME": {
                    const frame = figma.createFrame();
                    frame.name = nodeData.name || "Frame";

                    if (nodeData.backgroundColor) {
                      frame.fills = [{ type: "SOLID", color: hexToRgb(nodeData.backgroundColor) }];
                    }
                    if (nodeData.cornerRadius) frame.cornerRadius = nodeData.cornerRadius;

                    // Determine layout mode
                    let layoutMode = sanitizeLayoutMode(nodeData.layoutMode);
                    // Force AutoLayout on any frame with children
                    if (nodeData.children && nodeData.children.length > 0 && !layoutMode) {
                      layoutMode = "VERTICAL";
                    }

                    // Step 1: Determine target size
                    const explicitW = nodeData.width;
                    const explicitH = nodeData.height;

                    // Step 2: Enable AutoLayout FIRST
                    if (layoutMode) {
                      frame.layoutMode = layoutMode as "HORIZONTAL" | "VERTICAL";
                      frame.primaryAxisAlignItems = sanitizeAlign(nodeData.primaryAlign) as any;
                      frame.counterAxisAlignItems = sanitizeAlign(nodeData.crossAlign) as any;
                      if (typeof nodeData.itemSpacing === 'number') frame.itemSpacing = nodeData.itemSpacing;

                      const padding = nodeData.padding || 0;
                      frame.paddingLeft = padding;
                      frame.paddingRight = padding;
                      frame.paddingTop = padding;
                      frame.paddingBottom = padding;
                    }

                    // Step 3: Set size AFTER layoutMode (so resize sticks)
                    if (isRoot) {
                      // Smart sizing: HORIZONTAL root = desktop (1440x900), VERTICAL root = mobile (375x812)
                      const isDesktop = layoutMode === "HORIZONTAL" || (explicitW && explicitW > 600);
                      const defaultW = isDesktop ? 1440 : 375;
                      const defaultH = isDesktop ? 900 : 812;
                      const rootW = explicitW && explicitW > 200 ? explicitW : defaultW;
                      const rootH = explicitH && explicitH > 200 ? explicitH : defaultH;
                      // Lock BOTH axes to FIXED so AutoLayout doesn't shrink the frame
                      frame.layoutSizingHorizontal = "FIXED";
                      frame.layoutSizingVertical = "FIXED";
                      frame.resize(rootW, rootH);
                    } else if (explicitW && explicitH) {
                      frame.resize(explicitW, explicitH);
                    }

                    // Step 4: Create children and append them
                    if (nodeData.children && Array.isArray(nodeData.children)) {
                      for (const childData of nodeData.children) {
                        const child = createNode(childData, false);
                        if (!child) continue;

                        frame.appendChild(child);

                        // Step 5 (CRITICAL): After appendChild, set child sizing based on PARENT layout.
                        // layoutSizing ONLY works after the node is inside an AutoLayout parent.
                        if (layoutMode) {
                          try {
                            const childHSizing = sanitizeSizing(childData.layoutSizingHorizontal);
                            const childVSizing = sanitizeSizing(childData.layoutSizingVertical);
                            const childType = (childData.type || "").toUpperCase();

                            if (layoutMode === "VERTICAL") {
                              // Cross-axis (horizontal): stretch to parent width
                              if (childType === "RECTANGLE") {
                                (child as any).layoutSizingHorizontal = childHSizing || "FIXED";
                              } else {
                                (child as any).layoutSizingHorizontal = childHSizing || "FILL";
                              }
                              // Primary-axis (vertical): HUG content height by default
                              // This is THE critical fix — without this, child FRAMEs stay at
                              // FIXED 100px (Figma default) and content overflows or gets clipped
                              if (childType === "FRAME") {
                                (child as any).layoutSizingVertical = childVSizing || "HUG";
                              } else if (childType === "RECTANGLE") {
                                (child as any).layoutSizingVertical = childVSizing || "FIXED";
                              } else if (childVSizing) {
                                (child as any).layoutSizingVertical = childVSizing;
                              }
                              // Text nodes: switch to height-only auto-resize so text wraps at FILL width
                              if (childType === "TEXT") {
                                (child as TextNode).textAutoResize = "HEIGHT";
                              }
                            } else if (layoutMode === "HORIZONTAL") {
                              // Cross-axis (vertical): stretch to parent height
                              if (childType === "RECTANGLE") {
                                (child as any).layoutSizingVertical = childVSizing || "FIXED";
                                (child as any).layoutSizingHorizontal = childHSizing || "FIXED";
                              } else if (childType === "FRAME") {
                                (child as any).layoutSizingVertical = childVSizing || "FILL";
                                // Primary-axis (horizontal): FIXED if explicit width, else FILL
                                if (childData.width && !childHSizing) {
                                  (child as any).layoutSizingHorizontal = "FIXED";
                                } else {
                                  (child as any).layoutSizingHorizontal = childHSizing || "FILL";
                                }
                              } else if (childType === "TEXT") {
                                // Text in horizontal: keep natural size, don't stretch
                              }
                            }
                          } catch (e) {
                            // Some node types may not support layoutSizing, silently skip
                          }
                        }
                      }
                    }

                    applyHighFidelityProps(frame, nodeData);
                    node = frame;
                    break;
                  }

                  case "RECTANGLE": {
                    const rect = figma.createRectangle();
                    rect.name = nodeData.name || "Rectangle";
                    rect.resize(nodeData.width || 100, nodeData.height || 100);
                    if (nodeData.backgroundColor) {
                      rect.fills = [{ type: "SOLID", color: hexToRgb(nodeData.backgroundColor) }];
                    }
                    if (nodeData.cornerRadius) rect.cornerRadius = nodeData.cornerRadius;
                    applyHighFidelityProps(rect, nodeData);
                    node = rect;
                    break;
                  }

                  case "TEXT": {
                    const text = figma.createText();
                    text.name = nodeData.name || "Text";
                    text.characters = nodeData.characters || "Text";
                    text.fontSize = nodeData.fontSize || 14;
                    if (nodeData.color) {
                      text.fills = [{ type: "SOLID", color: hexToRgb(nodeData.color) }];
                    }
                    // Default to auto-size; parent will override to HEIGHT if needed (for text wrapping)
                    text.textAutoResize = "WIDTH_AND_HEIGHT";
                    applyHighFidelityProps(text, nodeData);
                    node = text;
                    break;
                  }

                  default:
                    return null;
                }

                return node;
              } catch (e) {
                console.error("Error creating node", nodeData, e);
                return null;
              }
            };

            // ===== Render pages and frames =====
            if (data.pages && Array.isArray(data.pages)) {
              const createdNodes: SceneNode[] = [];
              const firstPage = figma.currentPage;

              for (let i = 0; i < data.pages.length; i++) {
                const pageData = data.pages[i];
                let targetPage = firstPage;

                if (i > 0) {
                  targetPage = figma.createPage();
                  targetPage.name = pageData.name || `Page ${i + 1}`;
                }

                if (pageData.frames && Array.isArray(pageData.frames)) {
                  let currentX = 0;
                  for (const frameData of pageData.frames) {
                    // Root frames are always isRoot=true => smart sizing (mobile/desktop)
                    const rootNode = createNode(frameData, true);
                    if (rootNode) {
                      targetPage.appendChild(rootNode);
                      rootNode.x = currentX;
                      rootNode.y = 0;
                      currentX += rootNode.width + 100;
                      if (i === 0) createdNodes.push(rootNode);
                    }
                  }
                }
              }

              if (createdNodes.length > 0) {
                figma.viewport.scrollAndZoomIntoView(createdNodes);
              }
            } else {
              // Fallback for legacy single-frame format
              const rootNode = createNode(data, true);
              if (rootNode) {
                figma.currentPage.appendChild(rootNode);
                figma.viewport.scrollAndZoomIntoView([rootNode]);
              }
            }
          },
          { jsonStr: text }
        );
      };

      await drawInFigma();

    } catch (e) {
       console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-900 text-white p-5">
      <h1 className="text-3xl font-bold mb-2">提示词生成设计稿</h1>
      <div className="text-sm mb-6 text-gray-300 text-center">
        输入提示词，直接在画布上生成高保真 UI 设计稿。
      </div>
      
      <textarea
        className="w-full h-32 p-3 rounded bg-gray-800 text-white border border-gray-600 focus:outline-none focus:border-indigo-500 mb-4"
        placeholder="例如：一个现代化的登录界面，包含蓝色的按钮..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <button
        onClick={onGenerateDesign}
        disabled={isGenerating || !prompt.trim()}
        className={`w-full p-3 rounded font-bold transition-colors ${
          isGenerating || !prompt.trim() 
            ? "bg-gray-700 text-gray-400 cursor-not-allowed" 
            : "bg-indigo-600 text-white hover:bg-indigo-700"
        }`}
      >
        {isGenerating ? "正在生成设计稿..." : "在画布上生成设计"}
      </button>

      {debugText && (
        <div className="w-full mt-6">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">原生 JSON 输出</h3>
          <div className="border border-gray-700 rounded p-4 bg-gray-950 shadow-inner overflow-auto h-48 text-gray-400 text-xs font-mono">
            <pre className="whitespace-pre-wrap">{debugText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
