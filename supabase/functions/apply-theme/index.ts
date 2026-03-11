const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { image, theme_image } = await req.json();

    if (!image || !theme_image) {
      return new Response(
        JSON.stringify({ error: "image and theme_image are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Extract the color palette from the theme image (text-only, no image generation)
    const extractResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this image and extract its complete color theme. List the dominant colors as hex codes, describe the overall mood/tone (warm, cold, vibrant, muted, dark, light), the lighting style, and any color gradients present. Be very specific and detailed. Return ONLY the analysis, no other text.",
              },
              {
                type: "image_url",
                image_url: { url: theme_image },
              },
            ],
          },
        ],
      }),
    });

    if (!extractResponse.ok) {
      const errText = await extractResponse.text();
      console.error("Theme extraction error:", extractResponse.status, errText);
      throw new Error("Failed to extract theme");
    }

    const extractData = await extractResponse.json();
    const themeDescription = extractData.choices?.[0]?.message?.content || "";
    console.log("Extracted theme:", themeDescription.slice(0, 200));

    // Step 2: Apply the extracted theme to the original image (image generation)
    const applyResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You MUST edit this image by applying the following color theme to it. Do NOT change the content, layout, composition, text, objects, or structure of the image AT ALL. Only adjust the colors, lighting, tones, and mood to match this theme:\n\n${themeDescription}\n\nCRITICAL RULES:\n- Keep the EXACT same image content, objects, text, and composition\n- Only change colors, color grading, lighting, and tonal values\n- The output must have the same dimensions and aspect ratio as the input\n- Do NOT add, remove, or rearrange any elements\n- Think of this as applying a color filter/grade to the image`,
              },
              {
                type: "image_url",
                image_url: { url: image },
              },
            ],
          },
        ],
        modalities: ["image", "text"],
      }),
    });

    if (!applyResponse.ok) {
      if (applyResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições atingido. Aguarde e tente novamente." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (applyResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos insuficientes. Adicione créditos para continuar." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await applyResponse.text();
      console.error("Theme apply error:", applyResponse.status, errText);
      throw new Error("Failed to apply theme");
    }

    const applyData = await applyResponse.json();
    const editedImageUrl = applyData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!editedImageUrl) {
      console.error("No image in apply response:", JSON.stringify(applyData).slice(0, 500));
      return new Response(
        JSON.stringify({ error: "IA não retornou a imagem com tema aplicado. Tente novamente." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ image: editedImageUrl, theme: themeDescription }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("apply-theme error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
