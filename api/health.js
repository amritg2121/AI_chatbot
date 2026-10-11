// Open /api/health in the browser to check the deployment. It never shows the key itself.
module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    keySet: Boolean(process.env.GEMINI_API_KEY),
    models: [...new Set([process.env.GEMINI_MODEL, 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash'].filter(Boolean))]
  })
}
