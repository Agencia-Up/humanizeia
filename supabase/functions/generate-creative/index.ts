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

    const { prompt, format, style, headline, ctaText, includeLogo, includeCTA, primaryColor, secondaryColor, styleIntensity, variations } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build detailed image generation prompt
    const formatMap: Record<string, string> = {
      "feed-1x1": "square 1:1 aspect ratio, 1080x1080px, Instagram feed post",
      "feed-4x5": "portrait 4:5 aspect ratio, 1080x1350px, Instagram feed post",
      "stories-9x16": "vertical 9:16 aspect ratio, 1080x1920px, Instagram/TikTok story",
      "landscape-16x9": "landscape 16:9 aspect ratio, 1920x1080px, YouTube thumbnail or banner",
      "display-300x250": "square 1:1 aspect ratio, display ad",
      "display-728x90": "landscape 16:9 aspect ratio, leaderboard banner, display ad",
    };

    // Supported aspect ratios: 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
    const aspectRatioMap: Record<string, string> = {
      "feed-1x1": "1:1",
      "feed-4x5": "4:5",
      "stories-9x16": "9:16",
      "landscape-16x9": "16:9",
      "display-300x250": "1:1",
      "display-728x90": "16:9",
    };

    const styleMap: Record<string, string> = {
      photorealistic: "photorealistic, high quality photograph",
      illustration: "digital illustration, artistic",
      flat: "flat design, clean vector style, minimal shadows",
      "3d": "3D rendered, volumetric lighting, depth",
      minimal: "minimalist, clean, lots of whitespace",
      neon: "neon lights, glowing effects, dark background",
      vintage: "vintage, retro aesthetic, film grain",
      lifestyle: "lifestyle photography, natural, candid feel",
    };

    const selectedAspectRatio = aspectRatioMap[format] || "1:1";

    const imagePrompt = `Create an advertising creative image with these specifications:
- Description: ${prompt}
- Format: ${formatMap[format] || format}
- Visual style: ${styleMap[style] || style} (intensity: ${styleIntensity}/10)
- Color palette: ${primaryColor}${secondaryColor ? `, ${secondaryColor}` : ''}
${headline ? `- Text overlay headline: "${headline}" — CRITICAL: reproduce this text EXACTLY as written, character by character. Do NOT add, remove, or change any accents, diacritics, or special characters. Copy it verbatim.` : "- No text overlay"}
${includeCTA && ctaText ? `- Call-to-action button with text: "${ctaText}" — CRITICAL: reproduce this text EXACTLY as written, do NOT modify accents or spelling.` : ""}
${includeLogo ? "- Include space for a logo in the corner" : ""}
- This is a professional advertising creative, polished and ready for social media ads.
- Ultra high resolution, sharp details.
- IMPORTANT: Any text rendered in the image must be copied EXACTLY from the inputs above. Do not correct, translate, or add accents to any word.`;

    console.log("Generating", variations, "images with aspect ratio:", selectedAspectRatio);

    // Generate images in parallel
    const imagePromises = Array.from({ length: variations }, async (_, i) => {
      try {
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
                content: `${imagePrompt}\n\nVariation ${i + 1} of ${variations}. Make this variation unique with slightly different composition or emphasis.`,
              },
            ],
            modalities: ["image", "text"],
            image_config: {
              aspect_ratio: selectedAspectRatio,
            },
          }),
        });

        if (!response.ok) {
          if (response.status === 429) {
            return { index: i, error: "rate_limit", message: "Rate limit exceeded" };
          }
          if (response.status === 402) {
            return { index: i, error: "payment_required", message: "Credits exhausted" };
          }
          const text = await response.text();
          console.error(`Image ${i} generation failed:`, response.status, text);
          return { index: i, error: "generation_failed", message: `Failed: ${response.status}` };
        }

        const data = await response.json();
        const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        const description = data.choices?.[0]?.message?.content || "";

        if (!imageUrl) {
          console.error(`Image ${i}: no image in response`, JSON.stringify(data).slice(0, 500));
          return { index: i, error: "no_image", message: "No image generated" };
        }

        return { index: i, imageUrl, description };
      } catch (err) {
        console.error(`Image ${i} error:`, err);
        return { index: i, error: "exception", message: err instanceof Error ? err.message : "Unknown error" };
      }
    });

    const results = await Promise.all(imagePromises);

    const images = results
      .filter((r) => "imageUrl" in r && r.imageUrl)
      .map((r: any) => ({ imageUrl: r.imageUrl, description: r.description }));

    const errors = results.filter((r) => "error" in r);

    if (images.length === 0 && errors.length > 0) {
      const firstError = errors[0] as any;
      const status = firstError.error === "rate_limit" ? 429 : firstError.error === "payment_required" ? 402 : 500;
      return new Response(JSON.stringify({ error: firstError.message, details: errors }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ images, errors: errors.length > 0 ? errors : undefined }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-creative error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
