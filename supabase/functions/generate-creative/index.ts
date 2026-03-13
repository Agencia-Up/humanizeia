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
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.3');
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { prompt, format, style, headline, ctaText, includeLogo, includeCTA, primaryColor, secondaryColor, styleIntensity, variations, referenceImage } = await req.json();

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
      "reels-9x16": "vertical 9:16 aspect ratio, 1080x1920px, Instagram Reels cover/thumbnail, dynamic and eye-catching with bold text",
      "landscape-16x9": "landscape 16:9 aspect ratio, 1920x1080px, YouTube thumbnail or banner",
      "display-300x250": "square 1:1 aspect ratio, display ad",
      "display-728x90": "landscape 16:9 aspect ratio, leaderboard banner, display ad",
    };

    // Supported aspect ratios: 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
    const aspectRatioMap: Record<string, string> = {
      "feed-1x1": "1:1",
      "feed-4x5": "4:5",
      "stories-9x16": "9:16",
      "reels-9x16": "9:16",
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

    // Helper: spell out text so the model renders each character correctly
    const spellOut = (text: string) => text.split('').map(c => c === ' ' ? '(space)' : `"${c}"`).join(' ');

    const headlineBlock = headline
      ? `- TEXT OVERLAY (HEADLINE): The image MUST contain the following text rendered exactly:
  EXACT STRING: "${headline}"
  SPELLED OUT: ${spellOut(headline)}
  RULES: Copy every single character verbatim. Do NOT fix spelling, do NOT add/remove accents, do NOT translate, do NOT rearrange words. If the text is in Portuguese, keep it in Portuguese exactly as provided. Every letter, space, and punctuation mark must match perfectly.`
      : "- No text overlay needed.";

    const ctaBlock = includeCTA && ctaText
      ? `- CTA BUTTON TEXT: The call-to-action button MUST display exactly:
  EXACT STRING: "${ctaText}"
  SPELLED OUT: ${spellOut(ctaText)}
  Same rules: copy verbatim, no modifications whatsoever.`
      : "";

    const imagePrompt = `You are generating a professional advertising creative image. TEXT ACCURACY IS THE #1 PRIORITY.

DESIGN SPECS:
- Description: ${prompt}
- Format: ${formatMap[format] || format}
- Visual style: ${styleMap[style] || style} (intensity: ${styleIntensity}/10)
- Color palette: ${primaryColor}${secondaryColor ? `, ${secondaryColor}` : ''}
${headlineBlock}
${ctaBlock}
${includeLogo ? "- Include space for a logo in the corner" : ""}

QUALITY: Professional advertising creative, polished, ultra high resolution, sharp details.

⚠️ ABSOLUTE TEXT RULES — FOLLOW WITHOUT EXCEPTION:
1. Any text in the image MUST be copied CHARACTER BY CHARACTER from the strings above.
2. Do NOT auto-correct, translate, add accents, remove accents, or "fix" anything.
3. Do NOT invent extra words or omit any word.
4. If unsure about a character, refer to the SPELLED OUT version above.
5. Double-check every letter before finalizing.
6. Use a clean, highly legible font (bold sans-serif recommended) so every character is clearly readable.`;

    console.log("Generating", variations, "images with aspect ratio:", selectedAspectRatio);

    // Generate images in parallel
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    const imagePromises = Array.from({ length: variations }, async (_, i) => {
      try {
        const variationPrompt = `${imagePrompt}\n\nVariation ${i + 1} of ${variations}. Make this variation unique with slightly different composition or emphasis.`;

        // Build message content - text only or multimodal with reference image
        const messageContent: any[] = [];
        if (referenceImage) {
          messageContent.push({
            type: "text",
            text: `I'm providing a reference image. Use it as the base/inspiration and apply the following modifications:\n\n${variationPrompt}`,
          });
          messageContent.push({
            type: "image_url",
            image_url: { url: referenceImage },
          });
        } else {
          messageContent.push({ type: "text", text: variationPrompt });
        }

        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-image",
            messages: [{ role: "user", content: referenceImage ? messageContent : variationPrompt }],
            modalities: ["image", "text"],
            image_config: { aspect_ratio: selectedAspectRatio },
          }),
        });

        // Fallback to direct Gemini Imagen API on 429/402
        if ((response.status === 429 || response.status === 402) && GEMINI_API_KEY) {
          console.log(`Image ${i}: Lovable AI returned ${response.status}, falling back to Gemini direct...`);
          await response.text();

          const geminiImgUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`;
          const geminiResponse = await fetch(geminiImgUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: variationPrompt }] }],
              generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
            }),
          });

          if (geminiResponse.ok) {
            const geminiData = await geminiResponse.json();
            const parts = geminiData.candidates?.[0]?.content?.parts || [];
            const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
            const txtPart = parts.find((p: any) => p.text);
            if (imgPart) {
              const b64 = imgPart.inlineData.data;
              const mime = imgPart.inlineData.mimeType;
              return { index: i, imageUrl: `data:${mime};base64,${b64}`, description: txtPart?.text || "" };
            }
          } else {
            const errText = await geminiResponse.text();
            console.error(`Image ${i} Gemini fallback failed:`, geminiResponse.status, errText);
          }
          return { index: i, error: response.status === 429 ? "rate_limit" : "payment_required", message: `Lovable AI: ${response.status}, Gemini fallback also failed` };
        }

        if (response.status === 429) {
          return { index: i, error: "rate_limit", message: "Rate limit exceeded" };
        }
        if (response.status === 402) {
          return { index: i, error: "payment_required", message: "Credits exhausted" };
        }

        if (!response.ok) {
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
