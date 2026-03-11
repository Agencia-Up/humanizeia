const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function imageToBase64Part(image: string): Promise<{ mimeType: string; base64: string } | null> {
  if (image.startsWith("data:")) {
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
    const base64 = mimeMatch ? image.replace(/^data:image\/\w+;base64,/, "") : image;
    return { mimeType, base64 };
  } else if (image.startsWith("http")) {
    const resp = await fetch(image);
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "image/png";
    const mimeType = contentType.split(";")[0].trim();
    const arrayBuffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return { mimeType, base64: btoa(binary) };
  } else {
    return { mimeType: "image/png", base64: image };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { image, prompt, model, overlay_image, overlay_images } = await req.json();

    if (!image || !prompt) {
      return new Response(
        JSON.stringify({ error: "Image (base64) and prompt are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process main image
    const mainPart = await imageToBase64Part(image);
    if (!mainPart) {
      return new Response(
        JSON.stringify({ error: "Não foi possível processar a imagem principal" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build content parts
    const contentParts: any[] = [
      {
        type: "image_url",
        image_url: { url: `data:${mainPart.mimeType};base64,${mainPart.base64}` },
      },
    ];

    // Collect all overlay images (support both single and array)
    const allOverlays: string[] = [];
    if (overlay_images && Array.isArray(overlay_images)) {
      allOverlays.push(...overlay_images);
    } else if (overlay_image) {
      allOverlays.push(overlay_image);
    }

    // Process overlay images
    for (const ov of allOverlays) {
      const part = await imageToBase64Part(ov);
      if (part) {
        contentParts.push({
          type: "image_url",
          image_url: { url: `data:${part.mimeType};base64,${part.base64}` },
        });
      }
    }

    // Build text prompt
    if (allOverlays.length > 0) {
      const count = allOverlays.length + 1;
      contentParts.push({
        type: "text",
        text: `You have ${count} images. The first is the main/background image. The remaining ${allOverlays.length} image(s) are overlay images that should be combined with the first.\n\n${prompt}\n\nReturn the combined/merged image.`,
      });
    } else {
      contentParts.push({
        type: "text",
        text: `Edit this image according to the following instruction: ${prompt}\n\nReturn the edited image. Keep the same dimensions and aspect ratio as the original.`,
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: contentParts }],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições atingido. Aguarde e tente novamente." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos insuficientes. Adicione créditos para continuar." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "Erro ao processar imagem com IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const editedImageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const description = data.choices?.[0]?.message?.content || "";

    if (!editedImageUrl) {
      console.error("No image in response:", JSON.stringify(data).slice(0, 500));
      return new Response(
        JSON.stringify({ error: "IA não retornou uma imagem editada. Tente reformular o prompt." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ image: editedImageUrl, description }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("edit-image error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
