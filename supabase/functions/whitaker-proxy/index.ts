import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const WHITAKER_ENDPOINTS = [
  (word: string) => `https://latin-words.com/cgi-bin/translate.cgi?latin=${encodeURIComponent(word)}`,
  (word: string) => `https://latin-words.com/cgi-bin/translate.cgi?backup=1&latin=${encodeURIComponent(word)}`,
  (word: string) => `https://archives.nd.edu/cgi-bin/wordz.pl?keyword=${encodeURIComponent(word)}`,
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const word = url.searchParams.get("word");
    const endpointIndex = parseInt(url.searchParams.get("endpoint") || "0");

    if (!word) {
      return new Response(JSON.stringify({ error: "Missing 'word' parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const idx = Math.max(0, Math.min(endpointIndex, WHITAKER_ENDPOINTS.length - 1));
    const targetUrl = WHITAKER_ENDPOINTS[idx](word);

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WhitakerProxy/1.0)",
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ 
          error: `Whitaker's Words service returned status ${response.status}`,
          status: response.status 
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const html = await response.text();

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (err) {
    console.error("Whitaker proxy error:", err);
    return new Response(
      JSON.stringify({ 
        error: "Failed to fetch from Whitaker's Words",
        message: err instanceof Error ? err.message : String(err)
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});