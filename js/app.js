// ============================================
// 药品信息查询 App - Main Application
// ============================================

const { createApp, ref, computed, watch, nextTick, onMounted } = Vue;

// --- Data Loading ---
const drugData = ref([]);
let fuseInstance = null;
let dataLoaded = false;

async function loadDrugData() {
  try {
    let data;
    if (typeof INLINE_DRUG_DATA !== "undefined" && INLINE_DRUG_DATA) {
      data = INLINE_DRUG_DATA;
    } else {
      const base = APP_CONFIG.basePath || "";
      const resp = await fetch(base + "data/drugs.json");
      data = await resp.json();
    }
    drugData.value = data;
    dataLoaded = true;

    fuseInstance = new Fuse(data, {
      keys: [
        { name: "name", weight: 10 },
        { name: "genericName", weight: 8 },
        { name: "enName", weight: 5 },
        { name: "summary", weight: 6 },
        { name: "manufacturer", weight: 3 },
        { name: "category", weight: 4 },
        { name: "sections.prescribing_info.content.indications.body", weight: 5 },
        { name: "sections.prescribing_info.content.dosage.body", weight: 3 },
        { name: "sections.prescribing_info.content.adverse_reactions.body", weight: 3 },
        { name: "sections.prescribing_info.content.contraindications.body", weight: 4 },
        { name: "sections.faq.content.*.question", weight: 5 },
        { name: "sections.faq.content.*.answer", weight: 4 }
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 1
    });
  } catch (e) {
    console.error("Failed to load drug data:", e);
  }
}

// --- Categories ---
function getCategories() {
  const cats = {};
  const categoryOrder = ["维生素D₂", "鲑降钙素", "班布特罗", "学术文献"];
  drugData.value.forEach(d => {
    if (!cats[d.category]) cats[d.category] = { count: 0, icon: getCategoryIcon(d.category) };
    cats[d.category].count++;
  });
  const result = categoryOrder
    .filter(name => cats[name])
    .map(name => ({ name, count: cats[name].count, icon: cats[name].icon }));
  result.unshift({ name: "全部", count: drugData.value.length, icon: "📁" });
  return result;
}

function getCategoryIcon(category) {
  const iconMap = {
    "抗血小板药": "🞧8",
    "心血管系统": "❤️",
    "质子泵抑制剂": "🔬",
    "消化系统": "🏥",
    "口服降糖药": "💉",
    "内分泌系统": "⚖️",
    "鲑降钙素": "🐟",
    "学术文献": "📖",
    "班布特罗": "💊"
  };
  for (const [key, icon] of Object.entries(iconMap)) {
    if (category.includes(key)) return icon;
  }
  return "💊";
}

// --- App Component ---
const App = {
  setup() {
    const hasScroll = ref(false);
    const showSearch = ref(false);
    const searchQuery = ref("");
    const searchResults = ref([]);
    const previewFile = ref({ url: "", name: "" });
    const searchInput = ref(null);
    const currentRoute = ref("home");
    const activeCategory = ref("全部");
    const activeSection = ref("");
    const selectedQACategory = ref(null);
    const currentDrugId = ref("");
    const toast = ref({ show: false, message: "", timer: null });
    const guidelineFiles = ref((typeof INLINE_GUIDELINE_DATA !== "undefined" && INLINE_GUIDELINE_DATA) ? INLINE_GUIDELINE_DATA : []);
    const bambuterolGuidelineFiles = ref((typeof INLINE_BAMBUTEROL_GUIDELINE_DATA !== "undefined" && INLINE_BAMBUTEROL_GUIDELINE_DATA) ? INLINE_BAMBUTEROL_GUIDELINE_DATA : []);
    const salmonGuidelineFiles = ref((typeof INLINE_SALMON_GUIDELINE_DATA !== "undefined" && INLINE_SALMON_GUIDELINE_DATA) ? INLINE_SALMON_GUIDELINE_DATA : []);
    const guidelineCategory = ref("全部");

    // 每个药品取自己那份诊疗指南文献；没有独立列表的沿用全局列表。
    function guidelineSourceFor(drugId) {
      if (drugId === "bambuterol") return bambuterolGuidelineFiles.value;
      if (drugId && drugId.indexOf("salmon") === 0) return salmonGuidelineFiles.value;
      return guidelineFiles.value;
    }

    // Drug group selection
    const showDrugSelector = ref(false);
    const selectedDrugName = ref("");

    function showToast(msg, duration) {
      duration = duration || 2500;
      if (toast.value.timer) clearTimeout(toast.value.timer);
      toast.value.message = msg;
      toast.value.show = true;
      toast.value.timer = setTimeout(() => { toast.value.show = false; }, duration);
    }

    // Chat state
    const chatMessages = ref([]);
    const chatInput = ref("");
    const isThinking = ref(false);
    const apiKeyInput = ref("");
    const apiKeySet = ref(!!localStorage.getItem("deepseek_api_key"));
    const isRecording = ref(false);
    let voiceRecognition = null;   // 语音识别实例（不需要响应式）
    let voiceBaseText = "";        // 开始录音前输入框里已有的文字

    const guidelineCategories = computed(() => {
      const source = guidelineSourceFor(currentDrugId.value);
      const cats = new Set();
      source.forEach(f => cats.add(f.category));
      return ["全部", ...cats];
    });

    const filteredGuidelineFiles = computed(() => {
      const source = guidelineSourceFor(currentDrugId.value);
      if (guidelineCategory.value === "全部") return source;
      return source.filter(f => f.category === guidelineCategory.value);
    });

    const pageTitle = computed(() => {
      if (currentRoute.value === "home") return "海鲸药品信息查询";
      if (currentRoute.value === "search") return "搜索文献资料";

      if (currentRoute.value === "detail" && currentDrug.value) return currentDrug.value.name;
      if (currentRoute.value === "section-menu" && currentDrug.value) return currentDrug.value.name + " - 资料选择";
      if (currentRoute.value === "chat") return "AI 药品助手";
      if (currentRoute.value === "guideline") return "诊疗指南";
      if (currentRoute.value === "preview") return previewFile.value.name || "文件预览";
      return "海鲸药品信息查询";
    });

    const filteredDrugs = computed(() => {
      if (activeCategory.value === "全部") return drugData.value;
      return drugData.value.filter(d => d.category === activeCategory.value);
    });

    // displayDrugs: merge vitamin-d2 and vitamin-d2-400 into one group entry
    const displayDrugs = computed(() => {
      const list = filteredDrugs.value;
      const result = [];
      let groupAdded = false;
      for (const drug of list) {
        if (drug.id === "vitamin-d2" || drug.id === "vitamin-d2-400") {
          if (!groupAdded) {
            result.push({
              id: "vitamin-d2-group",
              name: "维生素D₂软胶囊",
              genericName: "维生素D₂",
              enName: "Vitamin D₂ Soft Capsules",
              category: drug.category,
              category2: drug.category2,
              manufacturer: drug.manufacturer,
              specification: "0.01mg（400单位） / 0.125mg（5000单位）",
              approvalNumber: "国药准字H20247143 / 国药准字H32023837",
              drugCode: "",
              summary: "维生素D₂用于维生素D缺乏的预防与治疗。南京海鲸药业生产。点击查看400单位和5000单位两种规格。",
              fileUrl: "",
              fullText: "",
              sections: drug.sections,
              isGroup: true
            });
            groupAdded = true;
          }
        } else {
          result.push(drug);
        }
      }
      return result;
    });

    const drugItems = computed(() => {
      return displayDrugs.value.filter(d => d.category !== "学术文献");
    });

    const academicItems = computed(() => {
      return displayDrugs.value.filter(d => d.category === "学术文献");
    });

    const currentDrug = computed(() => {
      return drugData.value.find(d => d.id === currentDrugId.value) || null;
    });

    const currentSectionObj = computed(() => {
      if (!currentDrug.value || !activeSection.value) return null;
      return currentDrug.value.sections[activeSection.value] || null;
    });

    const categories = computed(() => getCategories());

    function toggleChat() {
      if (currentRoute.value === "chat") {
        currentRoute.value = "home";
        return;
      }
      currentRoute.value = "chat";
      if (chatMessages.value.length === 0) {
        chatMessages.value.push({
          role: "assistant",
          text: "您好，欢迎来到海鲸药业学术支持查询小工具。我是AI学习助手，回答范围限定于公司内部上传的资料库（产品资料、临床数据、学术文献等），确保信息的准确与合规。请问有什么可以帮您？",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        });
      }
      scrollToTop();
    }

    async function sendMessage() {
      stopVoice();               // 正在录音时直接发消息，先停掉麦克风
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = "";
      chatMessages.value.push({ role: "user", text, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
      isThinking.value = true;
      try {
        let key = localStorage.getItem("deepseek_api_key");
        if (!key) throw new Error("请先设置 API Key");
        // RAG: build searchable knowledge base from all data
        function buildKnowledgeChunks() {
          const chunks = [];
          // Drug data
          drugData.value.forEach(d => {
            if (d.fullText) {
              const lines = (d.fullText || "").split("\n");
              let current = "【" + d.name + "】\n";
              lines.forEach(line => {
                if (current.length > 1500) { chunks.push(current); current = "【" + d.name + "】\n"; }
                current += line + "\n";
              });
              if (current.length > 50) chunks.push(current);
            }
          });
          // Guidelines - chunked full text
          const allGuideFiles = typeof bambuterolGuidelineFiles !== "undefined"
            ? [...guidelineFiles.value, ...bambuterolGuidelineFiles.value, ...salmonGuidelineFiles.value]
            : guidelineFiles.value;
          allGuideFiles.forEach(f => {
            if (f.fullText) {
              const gLines = (f.fullText || "").split("\n");
              let gCurrent = "【" + f.name + "】\n";
              gLines.forEach(gl => {
                if (gCurrent.length > 1500) { chunks.push(gCurrent); gCurrent = "【" + f.name + "】\n"; }
                gCurrent += gl + "\n";
              });
              if (gCurrent.length > 50) chunks.push(gCurrent);
            }
          })
          return chunks;
        }
        // Search knowledge base for relevant content
        function searchRelevant(query, chunks, maxResults) {
          maxResults = maxResults || 10;
          const rawWords = query.replace(/[。?，、！：；"''（）《》\s|]/g, " ").split(" ").filter(w => w.length > 0)
          const queryWords = []
          rawWords.forEach(w => {
            queryWords.push(w)
            if (/[一-鿿]/.test(w) && w.length > 1) {
              for (let ci = 0; ci < w.length - 1; ci++) {
                queryWords.push(w.substring(ci, ci + 2))
              }
            }
          })
          const scored = chunks.map(chunk => {
            let score = 0
            const lower = chunk.toLowerCase()
            queryWords.forEach(w => {
              const wl = w.toLowerCase()
              let idx2 = 0, count = 0
              while ((idx2 = lower.indexOf(wl, idx2)) >= 0) { count++; idx2 += wl.length }
              score += count * (w.length >= 2 ? w.length * 2 : 1)
            })
            return { chunk, score }
          })
          scored.sort((a, b) => b.score - a.score)
          return scored.filter(s => s.score > 0).slice(0, maxResults).map(s => s.chunk)
        }const allChunks = buildKnowledgeChunks();
        const relevantChunks = searchRelevant(text, allChunks);
        const context = relevantChunks.length > 0 
          ? relevantChunks.join("\n\n---\n\n")
          : "未找到与问题直接相关的资料，请根据你的专业知识回答。";
        const docCount = allChunks.length;
        // Build conversation history (last 6 exchanges to save tokens)
        const historyMsgs = [];
        const msgs = chatMessages.value;
        const startIdx = Math.max(0, msgs.length - 12); // last 6 exchanges = 12 messages
        for (let i = startIdx; i < msgs.length; i++) {
          const m = msgs[i];
          if (m.role === "user" || m.role === "assistant") {
            historyMsgs.push({ role: m.role, content: m.text });
          }
        }
        const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: "你是海鲸药业的AI学术小助手。请基于以下药品资料库的内容回答医药代表的问题。如果资料库中没有相关信息，请如实告知。不要编造信息。\n\n资料库内容：\n" + context },
              ...historyMsgs,
              { role: "user", content: text }
            ],
            temperature: 0.3,
            max_tokens: 2048,
            stream: false
          })
        });
        if (!resp.ok) throw new Error("API 错误: " + resp.status);
        const data = await resp.json();
        const reply = data.choices?.[0]?.message?.content || "抱歉，暂时无法获取回答。";
        chatMessages.value.push({ role: "assistant", text: reply, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
      } catch (e) {
        chatMessages.value.push({ role: "assistant", text: "错误: " + e.message, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
      }
      isThinking.value = false;
      await nextTick();
    }

    function saveApiKey() {
      const key = apiKeyInput.value.trim();
      if (key) {
        localStorage.setItem("deepseek_api_key", key);
        apiKeySet.value = true;
        showToast("API Key 已保存");
      }
    }

    function changeApiKey() {
      apiKeySet.value = false;
      apiKeyInput.value = "";
    }

    function startVoice() {
      if (!apiKeySet.value) {
        showToast("请先设置 API Key", 2200);
        return;
      }

      // 再点一次 = 停止
      if (isRecording.value) {
        stopVoice();
        return;
      }

      const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Ctor) {
        // 微信内置浏览器、部分国产内核浏览器不支持这个接口
        showToast("当前浏览器不支持语音输入，可点输入框后用键盘上的麦克风说话", 3800);
        return;
      }

      try {
        voiceRecognition = new Ctor();
      } catch (e) {
        showToast("语音输入启动失败", 2500);
        return;
      }

      voiceRecognition.lang = "zh-CN";
      voiceRecognition.continuous = false;
      voiceRecognition.interimResults = true;   // 边说边出字，让人知道在听
      voiceRecognition.maxAlternatives = 1;

      // 记下开始录音前输入框里的内容，识别结果接在后面，不覆盖用户已经打的字
      voiceBaseText = chatInput.value || "";

      voiceRecognition.onstart = function () {
        isRecording.value = true;
      };

      voiceRecognition.onresult = function (event) {
        let text = "";
        for (let i = 0; i < event.results.length; i++) {
          text += event.results[i][0].transcript;
        }
        chatInput.value = voiceBaseText + text;
      };

      voiceRecognition.onerror = function (event) {
        isRecording.value = false;
        voiceRecognition = null;
        const code = event && event.error;
        if (code === "aborted") return;                    // 用户自己停的，不提示
        if (code === "not-allowed" || code === "service-not-allowed") {
          showToast("没有麦克风权限，请在浏览器设置里允许后重试", 3500);
        } else if (code === "no-speech") {
          showToast("没有听到声音，请再说一次", 2500);
        } else if (code === "network") {
          // 国内网络连不上浏览器的语音服务时会走到这里
          showToast("语音服务连不上，可点输入框后用键盘上的麦克风说话", 3800);
        } else {
          showToast("语音识别失败：" + (code || "未知原因"), 3000);
        }
      };

      voiceRecognition.onend = function () {
        isRecording.value = false;
        voiceRecognition = null;
      };

      try {
        voiceRecognition.start();
        isRecording.value = true;
        showToast("正在聆听…说完自动结束，再点一次可提前停止", 2200);
      } catch (e) {
        isRecording.value = false;
        voiceRecognition = null;
        showToast("语音输入启动失败，请稍后重试", 2600);
      }
    }

    function stopVoice() {
      if (voiceRecognition) {
        try { voiceRecognition.stop(); } catch (e) { /* ignore */ }
        voiceRecognition = null;
      }
      isRecording.value = false;
    }

    function filterByCategory(cat) {
      activeCategory.value = cat;
      currentDrugId.value = "";
      activeSection.value = "";
    }

    function viewDrug(id) {
      if (id === "vitamin-d2-group") {
        showDrugSelector.value = true;
        selectedDrugName.value = "维生素D₂软胶囊";
        return;
      }
      currentDrugId.value = id;
      const drug = drugData.value.find(d => d.id === id);
      if (drug && drug.category === "学术文献") {
        const keys = Object.keys(drug.sections || {});
        activeSection.value = keys[0] || "";
        currentRoute.value = "detail";
      } else {
        currentRoute.value = "section-menu";
      }
      scrollToTop();
    }

    function selectDrugSub(id) {
      showDrugSelector.value = false;
      selectedDrugName.value = "";
      currentDrugId.value = id;
      currentRoute.value = "section-menu";
      scrollToTop();
    }

    function goToSection(key) {
      const drug = currentDrug.value;
      if (!drug || !drug.sections || !drug.sections[key]) {
        showToast("栏目内容待添加", 2000);
        return;
      }
      if (key === "guideline") {
        // Check if this drug has guideline files
        const drugId = currentDrugId.value;
        const isVitaminD2 = drugId && (drugId.startsWith("vitamin-d2"));
        const isBambuterol = drugId === "bambuterol";
        const isSalmon = drugId && drugId.startsWith("salmon");
        if (!isVitaminD2 && !isBambuterol && !isSalmon) {
          showToast("栏目内容待添加", 2000);
          return;
        }
        guidelineCategory.value = "全部";
        currentRoute.value = "guideline";
        scrollToTop();
        return;
      }
      const section = drug.sections[key];
      const contentKeys = Object.keys(section.content || {});
      if (contentKeys.length === 0) {
        showToast("栏目内容待添加", 2000);
        return;
      }
      activeSection.value = key;
      currentRoute.value = "detail";
      scrollToTop();
    }

        
    function selectQACategory(key) {
      selectedQACategory.value = key;
    }
    function clearQACategory() {
      selectedQACategory.value = null;
    }


    function toggleSearch() {
      currentRoute.value = "search";
      searchQuery.value = "";
      searchResults.value = [];
    }

    function closeSearchDialog() {
      currentRoute.value = "home";
      searchQuery.value = "";
      searchResults.value = [];
    }

    function sdOpenFile(item) {
      const url = item.path || item.filePath || item.url || "";
      const name = item.name || item.fileName || item.title || "";
      if (url) {
        const fullUrl = getFileUrl(url);
        previewFile.value = { url: fullUrl, name: name, blobUrl: "" };
        currentRoute.value = "preview";
        fetch(fullUrl)
          .then(res => {
            if (!res.ok) throw new Error("Failed to fetch");
            return res.blob();
          })
          .then(blob => {
            const blobUrl = URL.createObjectURL(blob);
            previewFile.value = { ...previewFile.value, blobUrl: blobUrl };
          })
          .catch(() => {});
        // Reset search state without navigating to home
        searchQuery.value = "";
        searchResults.value = [];
      } else {
        showToast("文件链接无效", 2000);
        closeSearchDialog();
      }
    }


    // 搜索页空状态里推荐的几个关键词（点一下直接搜）
    const searchSuggestions = ["维生素D", "骨质疏松", "GOLD", "儿童", "哮喘", "孕产妇"];

    function applySuggestion(kw) {
      searchQuery.value = kw;
      searchGuidelines();
    }

    function escapeHtmlText(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function escapeRegExpText(str) {
      return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // 把命中的关键词高亮出来。先做 HTML 转义，避免注入。
    function highlightName(name, query) {
      const safe = escapeHtmlText(name || "");
      const q = String(query || "").trim();
      if (!q) return safe;
      try {
        const pattern = new RegExp(escapeRegExpText(escapeHtmlText(q)), "gi");
        return safe.replace(pattern, function (m) { return "<mark>" + m + "</mark>"; });
      } catch (e) {
        return safe;
      }
    }

    function searchGuidelines() {
      const q = searchQuery.value.trim().toLowerCase();
      if (!q) {
        searchResults.value = [];
        return;
      }
      const allFiles = [];
      // Add guideline files from ALL guideline sources
      const sources = [guidelineFiles, bambuterolGuidelineFiles, salmonGuidelineFiles];
      sources.forEach(src => {
        src.value.forEach(f => {
          const nameLower = (f.name || f.fileName || f.title || "").toLowerCase();
          const catLower = (f.category || "").toLowerCase();
          if (nameLower.includes(q) || catLower.includes(q)) {
            allFiles.push({ name: f.name || f.fileName || f.title, category: f.category || "", path: f.path || f.filePath || f.url || "", icon: "PDF" });
          }
        });
      });
      // Also search drug fullText for guidelines
      if (typeof drugData !== 'undefined' && drugData.value) {
        drugData.value.forEach(d => {
          if (d.fullText && d.fullText.toLowerCase().includes(q)) {
            // Only add if not already in results
            // Already covered by Fuse search in viewDrug - skip here
          }
        });
      }
      searchResults.value = allFiles;
    }

function goBack() {
      if (currentRoute.value === "chat") {
        currentRoute.value = "home";
        return;
      }
      if (currentRoute.value === "search") {
        currentRoute.value = "home";
        searchQuery.value = "";
        searchResults.value = [];
        return;
      }
      if (currentRoute.value === "guideline") {
        currentRoute.value = "section-menu";
        return;
      }
      if (currentRoute.value === "detail") {
        // If in QA sub-category, go back to category list
        if (activeSection.value === "qa" && selectedQACategory.value) {
          selectedQACategory.value = null;
          window.scrollTo({ top: 0, behavior: "instant" });
          return;
        }
        const drug = currentDrug.value;
        if (drug && drug.category === "学术文献") {
          currentRoute.value = "home";
          currentDrugId.value = "";
        } else {
          currentRoute.value = "section-menu";
        }
        activeSection.value = "";
        selectedQACategory.value = null;
        window.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
      if (currentRoute.value === "preview") {
        if (previewFile.value.blobUrl) {
          URL.revokeObjectURL(previewFile.value.blobUrl);
        }
        previewFile.value = { url: "", name: "", blobUrl: "" };
        currentRoute.value = "home";
        return;
      }
      if (currentRoute.value === "section-menu") {
        currentRoute.value = "home";
        currentDrugId.value = "";
        window.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
    }

    
    // APP_CONFIG 由远端 data.js 注入，给它留个兜底，
    // 免得 data.js 没加载出来时下载/预览直接报 ReferenceError。
    function getBasePath() {
      try {
        if (typeof APP_CONFIG !== "undefined" && APP_CONFIG && APP_CONFIG.basePath) {
          return APP_CONFIG.basePath;
        }
      } catch (e) { /* ignore */ }
      return "https://haijing-app-data.oss-cn-hangzhou.aliyuncs.com/";
    }

    // 逐段做百分号编码，保留 "/" 作为路径分隔符。
    // 文件名里可能有 "#" "?" "%" 空格 等字符，不编码的话浏览器会把它们当成
    // URL 的分隔符，请求就会打到不存在的 key 上（OSS 返回 404）。
    // 例：2018+ABM临床方案#29：... .pdf 会被截断成 .../2018+ABM临床方案
    function encodeFilePath(path) {
      return String(path).split("/").map(encodeURIComponent).join("/");
    }

    function getFileUrl(url) {
      const clean = String(url || "").split(/[\r\n]/)[0].trim();
      if (!clean) return "";
      if (/^https?:\/\//i.test(clean)) return clean;
      const alreadyEncoded = /%[0-9A-Fa-f]{2}/.test(clean);
      return getBasePath() + (alreadyEncoded ? clean : encodeFilePath(clean));
    }

    function triggerDownload(fullUrl, name) {
      // 用隐藏的 <a> 触发下载，比 window.open 更不容易被拦截，
      // 也不会在手机上留下一个空白新标签（OSS 带 attachment 头，页面不会被带走）。
      const a = document.createElement("a");
      a.href = fullUrl;
      a.rel = "noopener";
      if (name) a.download = name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    function toggleFullscreen() {
      const el = document.querySelector('.page-preview');
      if (!el) return;
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        el.requestFullscreen();
      }
    }

    function downloadFile(url, name) {
      const fullUrl = getFileUrl(url);
      if (!fullUrl) {
        showToast("文件链接无效", 2000);
        return;
      }
      // 先确认文件真的在。否则用户点下载只会被带到一个满是 XML 报错的页面，
      // 完全看不懂发生了什么。这里失败就直接给出中文提示。
      fetch(fullUrl, { method: "HEAD" })
        .then(res => {
          if (res.ok) {
            triggerDownload(fullUrl, name);
            return;
          }
          if (res.status === 404) {
            showToast("文件不存在，可能已被移动或删除，请联系管理员", 3200);
          } else if (res.status === 403) {
            showToast("没有权限下载该文件（403）", 3000);
          } else {
            showToast("下载失败：服务器返回 " + res.status, 3000);
          }
        })
        .catch(() => {
          // HEAD 跨域被拦或网络异常时，不阻断下载，交给浏览器处理
          triggerDownload(fullUrl, name);
        });
    }

    // ---------------------------------------------------------------
    // 推广科室 / QA问答 这两个栏目的内容是数据里带过来的整段 HTML，
    // 里面的链接被写成了相对路径，例如：
    //   <a href="files/promotion/芬达宁在成人咳喘疾病中的应用-呼吸科、老年科.pdf">
    // 相对路径是按"当前网页所在的位置"去解析的，而文件其实在阿里云 OSS 上，
    // 所以线上点开一定是 404 —— 用户看到的就是"当前文件路径不存在"。
    //
    // 处理办法：
    //   1) 渲染时把 href 换成 OSS 绝对地址（长按 / 中键打开也是对的）
    //   2) 点击时接管，统一走应用自己的下载逻辑
    // ---------------------------------------------------------------
    function fixContentLinks(html) {
      if (!html) return "";
      return String(html).replace(
        /(href\s*=\s*)(["'])(files\/[^"'\s>]+)\2/gi,
        function (match, prefix, quote, path) {
          return prefix + quote + getFileUrl(path) + quote;
        }
      );
    }

    // 从 href 里还原出相对路径（files/...），
    // 不管是相对写法还是已经换成 OSS 绝对地址
    function filePathFromHref(href) {
      if (!href) return "";
      if (/^files\//i.test(href)) return href;
      const base = getBasePath();
      if (base && href.indexOf(base) === 0) {
        const rest = href.slice(base.length);
        try { return decodeURI(rest); } catch (e) { return rest; }
      }
      const idx = href.indexOf("files/");
      if (idx > 0 && href.indexOf("oss-cn-") >= 0) {
        const rest = href.slice(idx);
        try { return decodeURI(rest); } catch (e) { return rest; }
      }
      return "";
    }

    function onContentClick(event) {
      const el = event.target;
      const anchor = el && el.closest ? el.closest("a[href]") : null;
      if (!anchor) return;

      const href = anchor.getAttribute("href") || "";
      const path = filePathFromHref(href);
      if (!path) return;               // 不是资料链接，交给浏览器自己处理

      event.preventDefault();
      const nameEl = anchor.querySelector(".gl-item-name");
      const name = nameEl ? nameEl.textContent.trim() : "文件";
      downloadFile(path, name);
    }

    function openFile(url, name) {
      if (!url) {
        showToast("文件链接无效", 2000);
        return;
      }
      const fullUrl = getFileUrl(url);
      previewFile.value = { url: fullUrl, name: name || "文件预览", blobUrl: "" };
      currentRoute.value = "preview";
      // Try to load PDF as blob for inline preview
      fetch(fullUrl)
        .then(res => {
          if (!res.ok) throw new Error("Failed to fetch");
          return res.blob();
        })
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          previewFile.value = { ...previewFile.value, blobUrl: blobUrl };
        })
        .catch(() => {
          // Fallback: use direct URL, browser may handle it natively
        });
    }
function scrollToTop() {
      window.scrollTo({ top: 0, behavior: "instant" });
    }

            function renderMarkdown(text) {
      if (!text) return "";
      text = text.replace(/\\n/g, "\x00BR\x00");
      let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      const lines = html.split("\n");
      for (let li = 0; li < lines.length; li++) {
        lines[li] = lines[li].replace(/^#+\s+/, "");
      }
      const blocks = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) { i++; continue; }
        if (line.startsWith("|") && line.endsWith("|") && line.length > 2) {
          const tableRows = [];
          while (i < lines.length) {
            const l = lines[i].trim();
            if (!l.startsWith("|")) break;
            const cells = l.split("|").filter(c => c.trim());
            if (cells.length > 0 && cells.every(c => /^[\s:-]+$/.test(c.trim()))) { i++; continue; }
            tableRows.push(l); i++;
          }
          let tableHtml = "<div style='overflow-x:auto'><table style='width:auto'>";
          if (tableRows.length > 0) {
            const headers = tableRows[0].split("|").filter(c => c.trim());
            if (headers.length > 0) {
              tableHtml += "<thead><tr>" + headers.map(h => "<th >" + h.trim() + "</th>").join("") + "</tr></thead>";
            }
            if (tableRows.length > 1) {
              tableHtml += "<tbody>";
              for (let r = 1; r < tableRows.length; r++) {
                const cells = tableRows[r].split("|").filter(c => c.trim());
                tableHtml += "<tr>" + cells.map(c => "<td >" + c.trim() + "</td>").join("") + "</tr>";
              }
              tableHtml += "</tbody>";
            }
          }
          tableHtml += "</table></div>";
          tableHtml = tableHtml.replace(/\x00BR\x00/g, "<br>");
          blocks.push(tableHtml);
          continue;
        }
        if (/^\d+[\.\u3002]\s/.test(line)) {
          const listItems = [];
          while (i < lines.length) {
            const l = lines[i].trim();
            if (/^\d+[\.\u3002]\s/.test(l)) { listItems.push("<li>" + l.replace(/^\d+[\.\u3002]\s/, "").replace(/\x00BR\x00/g, "<br>") + "</li>"); i++; }
            else break;
          }
          blocks.push("<ol>" + listItems.join("") + "</ol>");
          continue;
        }
        if (/^[-*\u2022]\s/.test(line)) {
          const listItems = [];
          while (i < lines.length) {
            const l = lines[i].trim();
            if (/^[-*\u2022]\s/.test(l)) { listItems.push("<li>" + l.replace(/^[-*\u2022]\s/, "").replace(/\x00BR\x00/g, "<br>") + "</li>"); i++; }
            else break;
          }
          blocks.push("<ul>" + listItems.join("") + "</ul>");
          continue;
        }
        const paraLines = [];
        while (i < lines.length) {
          const l = lines[i].trim();
          if (!l) break;
          if (l.startsWith("|") || /^\d+[\.\u3002]\s/.test(l) || /^[-*\u2022]\s/.test(l)) break;
          paraLines.push(l.replace(/\x00BR\x00/g, "<br>")); i++;
        }
        if (paraLines.length > 0) blocks.push("<p>" + paraLines.join("<br>") + "</p>");
      }
      return blocks.join("\n").replace(/\x00BR\x00/g, "<br>");
    }
    function onScroll() { hasScroll.value = window.scrollY > 5; }

    function handlePopState() {
      if (currentRoute.value === "detail") {
        currentRoute.value = "home";
        currentDrugId.value = "";
        activeSection.value = "";
      }
    }

    onMounted(() => {
      loadDrugData();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("popstate", handlePopState);
    });

    return {
      hasScroll, showSearch, searchQuery, searchResults, searchInput,
      currentRoute, activeCategory, activeSection, currentDrugId, toast,
      guidelineFiles, bambuterolGuidelineFiles, salmonGuidelineFiles, guidelineCategory, guidelineCategories, filteredGuidelineFiles,
      pageTitle, filteredDrugs, currentDrug, currentSectionObj, categories,
      filterByCategory, viewDrug, goBack, goToSection, renderMarkdown, scrollToTop,
      selectedQACategory, selectQACategory, clearQACategory,
      showDrugSelector, selectedDrugName, selectDrugSub, displayDrugs,
      drugItems, academicItems,
      toggleChat, sendMessage, chatMessages, chatInput,
      isThinking, apiKeyInput, apiKeySet, saveApiKey, changeApiKey,
      showToast, isRecording, startVoice, getFileUrl, openFile,
      toggleSearch, closeSearchDialog, sdOpenFile,
      previewFile,
      downloadFile,
      fixContentLinks, onContentClick,
      toggleFullscreen,
      searchGuidelines,
      searchSuggestions, applySuggestion, highlightName
    };
  }
};

const app = createApp(App);
app.mount("#app");








