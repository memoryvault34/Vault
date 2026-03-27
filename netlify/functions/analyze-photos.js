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
    const dateContext = dateFrom && dateTo ? `The user wants memories from ${dateFrom} to ${dateTo}.` : dateFrom ? `The user wants memories from ${dateFrom} onwards.` : dateTo ? `The user wants memories up to ${dateTo}.` : "No specific date range specified.";
    const userPrompt = prompt ? `The user specifically wants: "${prompt}".` : "The user wants emotionally significant memories.";
    const batchSize = 5;
    const results = [];
    for (let i = 0; i < photos.length; i += batchSize) {
      const batch = photos.slice(i, i + batchSize);
      const content = [
        {
          type: "text",
          text: `You are analyzing photos for a memory vault app. ${dateContext} ${userPrompt} I'm going to show you ${batch.length} photo(s). For each photo, analyze it and respond with a JSON array. Each element should have: "index": the photo's index in the batch (0-based), "include": true or false, "score": 0.0 to 1.0, "reason": a specific 1-sentence description, "detectedDate": YYYY-MM-DD or null, "detectedLocation": string or null, "mood": one of "celebratory", "intimate", "adventurous", "everyday", "milestone", "unknown". Respond ONLY with the JSON array, no other text.`
        }
      ];
      batch.forEach((photo) => {
        const base64Data = photo.src.replace(/^data:image\/\w+;base64,/, "");
        const mediaType = photo.src.match(/^data:(image\/\w+);base64,/)?.[1] || "image/jpeg";
        content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } });
      });
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-opus-4-6", max_tokens: 1024, messages: [{ role: "user", content }] }),
      });
      if (!response.ok) {
        batch.forEach((photo, idx) => {
          results.push({ id: photo.id, index: i + idx, include: Math.random() > 0.3, score: Math.random(), reason: "Analysis temporarily unavailable.", detectedDate: photo.date || null, detectedLocation: null, mood: "unknown" });
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
        batchResults = [];
      }
      batch.forEach((photo, batchIdx) => {
        const analysis = batchResults.find(r => r.index === batchIdx) || {};
        results.push({ id: photo.id, name: photo.name, src: photo.src, date: analysis.detectedDate || photo.date, aiScore: analysis.score ?? Math.random(), aiRea
