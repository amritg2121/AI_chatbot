// Vercel serverless function. The Gemini API key stays on the server (GEMINI_API_KEY env var).
const ALLOWED_IMAGES = /^image\/(png|jpeg|webp|gif|heic|heif)$/

// Tried in order. If one is unavailable (404) the next is used.
const MODELS = [...new Set([
  process.env.GEMINI_MODEL,
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash'
].filter(Boolean))]

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server' })
  }

  const { message, file } = req.body || {}
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' })
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'Message is too long' })
  }

  const parts = [{ text: message }]
  if (file && file.data) {
    if (!ALLOWED_IMAGES.test(file.mime_type || '')) {
      return res.status(400).json({ error: 'Unsupported image type' })
    }
    parts.push({ inline_data: { mime_type: file.mime_type, data: file.data } })
  }

  let last = { status: 500, message: 'Gemini API error' }
  try {
    for (const model of MODELS) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ contents: [{ role: 'user', parts }] })
        }
      )
      const data = await response.json()

      if (response.ok) {
        const text = (data.candidates?.[0]?.content?.parts || [])
          .map(p => p.text || '').join('').trim()
        const blocked = data.promptFeedback && data.promptFeedback.blockReason
        return res.status(200).json({
          text: text || (blocked ? 'That request was blocked by the safety filter.' : 'No response was returned.')
        })
      }

      last = { status: response.status, message: (data && data.error && data.error.message) || 'Gemini API error' }
      console.error('Gemini error (' + model + '):', last.status, last.message)
      if (response.status !== 404) break   // only a missing model is worth retrying with another model
    }
  } catch (err) {
    console.error('Request failed:', err.message)
    return res.status(500).json({ error: 'Could not reach the Gemini API' })
  }

  if (last.status === 429) {
    return res.status(429).json({ error: 'Too many requests right now. Please wait a moment and try again.' })
  }
  return res.status(last.status).json({ error: last.message })
}
