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
              data = JSON.parse(cleanStr);
            } catch (e) {
              figma.notify("Failed to parse AI response as JSON", { error: true });
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

            const createNode = (nodeData: any): SceneNode | null => {
              let node: SceneNode;
              
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

              try {
                switch (nodeData.type) {
                  case "FRAME":
                    node = figma.createFrame();
                    node.name = nodeData.name || "Frame";
                    node.resize(nodeData.width || 375, nodeData.height || 812);
                    if (nodeData.backgroundColor) {
                      node.fills = [{ type: "SOLID", color: hexToRgb(nodeData.backgroundColor) }];
                    }
                    if (nodeData.cornerRadius) node.cornerRadius = nodeData.cornerRadius;
                    
                    if (nodeData.children && Array.isArray(nodeData.children)) {
                      nodeData.children.forEach((childData: any) => {
                        const child = createNode(childData);
                        if (child) {
                          (node as FrameNode).appendChild(child);
                        }
                      });
                    }
                    break;

                  case "RECTANGLE":
                    node = figma.createRectangle();
                    node.name = nodeData.name || "Rectangle";
                    node.resize(nodeData.width || 100, nodeData.height || 100);
                    if (nodeData.backgroundColor) {
                      node.fills = [{ type: "SOLID", color: hexToRgb(nodeData.backgroundColor) }];
                    }
                    if (nodeData.cornerRadius) node.cornerRadius = nodeData.cornerRadius;
                    break;

                  case "TEXT":
                    node = figma.createText();
                    node.name = nodeData.name || "Text";
                    node.characters = nodeData.characters || "Text";
                    node.fontSize = nodeData.fontSize || 14;
                    if (nodeData.color) {
                      node.fills = [{ type: "SOLID", color: hexToRgb(nodeData.color) }];
                    }
                    break;

                  default:
                    return null;
                }

                applyHighFidelityProps(node, nodeData);
                node.x = nodeData.x || 0;
                node.y = nodeData.y || 0;
                return node;
              } catch (e) {
                 console.error("Error creating node", e);
                 return null;
              }
            };

            const rootNode = createNode(data);
            if (rootNode) {
              figma.currentPage.appendChild(rootNode);
              figma.viewport.scrollAndZoomIntoView([rootNode]);
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
