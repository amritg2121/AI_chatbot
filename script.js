let prompt = document.querySelector("#prompt")
let submitbtn = document.querySelector("#submit")
let chatContainer = document.querySelector(".chat-container")
let imagebtn = document.querySelector("#image")
let image = document.querySelector("#image img")
let imageinput = document.querySelector("#imageInput")

// Your own backend (api/chat.js on Vercel). The Gemini key lives there, not here.
const API_URL = "/api/chat"
const MAX_IMAGE_BYTES = 3 * 1024 * 1024   // Vercel functions accept about 4.5 MB per request

let user = {
    message: null,
    file: { mime_type: null, data: null }
}
let isLoading = false
console.log("AI ChatBot v2 loaded")

function resetImage() {
    user.file = { mime_type: null, data: null }
    imageinput.value = ""
    image.src = "img.svg"
    image.classList.remove("choose")
}

// ---------- Small, safe Markdown renderer (no libraries) ----------
// Everything is HTML-escaped first, so nothing a model (or user) writes can inject HTML.
function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function inlineMd(s) {            // s is already HTML-escaped
    const codes = []
    s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000" })
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    s = s.replace(/__(.+?)__/g, "<strong>$1</strong>")
    s = s.replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?![*\w])/g, "$1<em>$2</em>")
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => "<code>" + codes[i] + "</code>")
}

function splitRow(line) {
    return line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim())
}

function renderMarkdown(src) {
    const lines = src.replace(/\r\n/g, "\n").split("\n")
    let html = "", para = [], i = 0
    const flushPara = () => {
        if (para.length) { html += "<p>" + para.map(inlineMd).join("<br>") + "</p>"; para = [] }
    }
    const isRow = l => /^\s*\|.*\|\s*$/.test(l)
    const isSep = l => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l)

    while (i < lines.length) {
        const raw = lines[i]

        // fenced code block
        if (/^\s*```/.test(raw)) {
            flushPara()
            const code = []
            i++
            while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++ }
            i++
            html += "<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>"
            continue
        }

        const line = escapeHtml(raw)
        let m

        if (!line.trim()) { flushPara(); i++; continue }

        // table
        if (isRow(raw) && i + 1 < lines.length && isSep(lines[i + 1])) {
            flushPara()
            const head = splitRow(line)
            i += 2
            const rows = []
            while (i < lines.length && isRow(lines[i])) { rows.push(splitRow(escapeHtml(lines[i]))); i++ }
            html += '<div class="table-wrap"><table><thead><tr>' + head.map(c => "<th>" + inlineMd(c) + "</th>").join("") +
                "</tr></thead><tbody>" + rows.map(r => "<tr>" + r.map(c => "<td>" + inlineMd(c) + "</td>").join("") + "</tr>").join("") +
                "</tbody></table></div>"
            continue
        }

        // horizontal rule
        if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushPara(); html += "<hr>"; i++; continue }

        // heading
        if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/))) {
            flushPara()
            const tag = m[1].length <= 3 ? "h3" : "h4"
            html += "<" + tag + ">" + inlineMd(m[2].replace(/\s*#+\s*$/, "")) + "</" + tag + ">"
            i++
            continue
        }

        // bullet or numbered item (nesting shown by indentation)
        const ul = line.match(/^(\s*)[-*+]\s+(.*)$/)
        const ol = ul ? null : line.match(/^(\s*)(\d+)[.)]\s+(.*)$/)
        if (ul || ol) {
            flushPara()
            const lead = (ul ? ul[1] : ol[1]).replace(/\t/g, "  ").length
            const indent = Math.min(Math.ceil(lead / 4), 3)
            const marker = ul ? (indent ? "\u25E6" : "\u2022") : ol[2] + "."
            const text = ul ? ul[2] : ol[3]
            html += '<div class="li ind' + indent + '"><span class="mk">' + marker + '</span><span class="tx">' + inlineMd(text) + "</span></div>"
            i++
            continue
        }

        para.push(line)
        i++
    }
    flushPara()
    return html
}

async function generateResponse(aiChatBox, message, file) {
    let text = aiChatBox.querySelector(".ai-chat-area")
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45000)   // give up after 45 s
    try {
        let response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: message, file: file.data ? file : null }),
            signal: controller.signal
        })
        let data = {}
        try { data = await response.json() } catch (e) { data = {} }
        if (!response.ok) {
            throw new Error(data.error || `Server error (${response.status}). Is the api folder deployed?`)
        }
        if (!data.text) throw new Error("Empty response from the server")
        text.innerHTML = '<div class="md">' + renderMarkdown(data.text.trim()) + "</div>"
    }
    catch (error) {
        console.log(error)
        text.textContent = error.name === "AbortError"
            ? "Sorry, that took too long. Please try again."
            : "Sorry, something went wrong: " + error.message
    }
    finally {
        clearTimeout(timer)
        isLoading = false
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" })
    }
}

function createChatBox(html, classes) {
    let div = document.createElement("div")
    div.innerHTML = html
    div.classList.add(classes)
    return div
}

function handlechatResponse(userMessage) {
    if (isLoading) return
    userMessage = userMessage.trim()
    if (!userMessage && !user.file.data) return
    if (!userMessage) userMessage = "Describe this image."

    isLoading = true
    user.message = userMessage
    const sentFile = { ...user.file }

    let html = `<img src="person.png" alt="You" id="userImage" width="8%">
<div class="user-chat-area">
<div class="user-text"></div>
${sentFile.data ? `<img src="data:${sentFile.mime_type};base64,${sentFile.data}" class="chooseimg" />` : ""}
</div>`
    let userChatBox = createChatBox(html, "user-chat-box")
    userChatBox.querySelector(".user-text").textContent = userMessage   // textContent: no HTML injection
    chatContainer.appendChild(userChatBox)

    prompt.value = ""
    resetImage()
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" })

    setTimeout(() => {
        let html = `<img src="aibot.png" alt="AI bot" id="aiImage" width="10%">
    <div class="ai-chat-area">
    <img src="loadding.png" alt="Loading" class="load" width="50px">
    </div>`
        let aiChatBox = createChatBox(html, "ai-chat-box")
        chatContainer.appendChild(aiChatBox)
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" })
        generateResponse(aiChatBox, userMessage, sentFile)
    }, 600)
}

prompt.addEventListener("keydown", (e) => {
    if (e.key == "Enter") {
        handlechatResponse(prompt.value)
    }
})

submitbtn.addEventListener("click", () => {
    handlechatResponse(prompt.value)
})

imageinput.addEventListener("change", () => {
    const file = imageinput.files[0]
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
        alert("Please choose an image smaller than 3 MB.")
        imageinput.value = ""
        return
    }
    let reader = new FileReader()
    reader.onload = (e) => {
        let base64string = e.target.result.split(",")[1]
        user.file = {
            mime_type: file.type,
            data: base64string
        }
        image.src = `data:${user.file.mime_type};base64,${user.file.data}`
        image.classList.add("choose")
    }
    reader.readAsDataURL(file)
})

imagebtn.addEventListener("click", () => {
    imageinput.click()
})
