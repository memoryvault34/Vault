exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  try {
    const { photos, prompt, dateFrom, dateTo } = JSON.parse(event.body);
    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No photos provided" }) };
    }
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
    }
    const dateContext = dateFrom && dateTo
      ? `The user wants memories from ${dateFrom} to ${dateTo}.`
      : dateFrom ? `The user wants memories from ${dateFrom} onwards.`
      : dateTo ? `The user wants memories up to ${dateTo}.`
      : "No specific date range specified.";
    const userPrompt = prompt
      ? `The user specifically wants: "${prompt}".`
      : "The user wants emotionally significant memories.";

    const batchSize = 5;
    const results = [];

    for (let i = 0; i < photos.length; i += batchSize) {
      const batch = photos.slice(i, i + batchSize);
      const content = [
        {
          type: "text",
          text: `You are analyzing photos for a memory vault app called Vault.

${dateContext}
${userPrompt}

I'm going to show you ${batch.length} photo(s). For each photo, analyze it carefully and respond with a JSON array.

Each element should have:
- "index": the photo's index in this batch (0-based)
- "include": true or false — should this photo be included based on the user's criteria?
- "score": 0.0 to 1.0 — how well does this match what the user asked for?
- "reason": a specific 1-sentence description of what you see and why it does/doesn't match
- "title": a short, evocative, human memory title (3-6 words max). Examples: "Summer Night in Rome", "Mom's 60th Birthday", "Last Day of College", "Beach Week with Everyone", "First Apartment Together". Make it feel like a memory, not a file name. If you can identify a location, use it.
- "description": a single warm, personal sentence describing the moment as if writing in a journal. Make it emotional and specific to what you see. Example: "The whole family crammed into one photo booth — nobody could stop laughing."
- "detectedDate": if you can read a date from the image (e.g. a timestamp), provide it as YYYY-MM-DD, otherwise null
- "detectedLocation": if you can identify a location from context clues, provide it as a string, otherwise null
- "mood": one of "celebratory", "intimate", "adventurous", "everyday", "milestone", "unknown"

Be specific and emotionally perceptive. The title and description are the most important — they're what users will see in their vault.
Respond ONLY with the JSON array, no other text.`
        }
      ];

      batch.forEach((photo) => {
        const base64Data = photo.src.replace(/^data:image\/\w+;base64,/, "");
        const mediaType = photo.src.match(/^data:(image\/\w+);base64,/)?.[1] || "image/jpeg";
        content.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64Data }
        });
      });

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          max_tokens: 1500,
          messages: [{ role: "user", content }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("Claude API error:", err);
        batch.forEach((photo, idx) => {
          results.push({
            id: photo.id,
            name: photo.name,
            src: photo.src,
            date: photo.date,
            aiScore: Math.random(),
            aiReason: "Analysis temporarily unavailable.",
            aiTitle: null,
            aiDescription: null,
            aiPick: Math.random() > 0.3,
            detectedDate: photo.date || null,
            detectedLocation: null,
            mood: "unknown",
          });
        });
        continue;
      }

      const data = await response.json();
      const rawText = data.content?.[0]?.text || "[]";
      let batchResults;
      try {
        const cleaned = rawText.replace(/```json\n?|\n?```/g, "").trim();
        batchResults = JSON.parse(cleaned);
      } catch (e) {
        console.error("Failed to parse Claude response:", rawText);
        batchResults = [];
      }

      batch.forEach((photo, batchIdx) => {
        const analysis = batchResults.find(r => r.index === batchIdx) || {};
        results.push({
          id: photo.id,
          name: photo.name,
          src: photo.src,
          date: analysis.detectedDate || photo.date,
          aiScore: analysis.score ?? Math.random(),
          aiReason: analysis.reason || "No analysis available.",
          aiTitle: analysis.title || null,
          aiDescription: analysis.description || null,
          aiPick: analysis.include ?? Math.random() > 0.3,
          detectedLocation: analysis.detectedLocation || null,
          mood: analysis.mood || "unknown",
        });
      });
    }

    results.sort((a, b) => b.aiScore - a.aiScore);
    return { statusCode: 200, headers, body: JSON.stringify({ results }) };

  } catch (error) {
    console.error("Function error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error", details: error.message }),
    };
  }
};
