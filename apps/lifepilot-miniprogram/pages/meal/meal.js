const sessionApi = require("../../services/session-api");
const memoryApi = require("../../services/memory-api");
const xiaowangApi = require("../../services/xiaowang-api");
const { getApiBaseUrl, getApiMode } = require("../../config/api");
const { normalizeDirectionCard, normalizeOfferCard, normalizeResult } = require("../../utils/card-normalizer");
const swipeGesture = require("../../utils/swipe-gesture");

const STORAGE_SESSION_ID = "lifepilot.activeSessionId";
const DEFAULT_USER_ID = "demo_weiyingru";
const LOCATION_LANDMARKS = [
  { label: "福田区 · 景田地铁站附近", latitude: 22.52291, longitude: 114.05454 },
  { label: "福田区 · 购物公园附近", latitude: 22.535, longitude: 114.049 },
  { label: "福田区 · 会展中心附近", latitude: 22.533, longitude: 114.061 },
  { label: "福田区 · 车公庙附近", latitude: 22.536, longitude: 114.028 },
];

function shortRunId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > 18 ? text.slice(-18) : text;
}

function sourceLabelForAssistant(message) {
  const mode = String(message.mode || "").trim();
  if (mode === "openclaw_gateway_client") return "AI · OpenClaw";
  if (mode === "ark_fallback_after_openclaw_error") return "AI · Ark 兜底";
  if (mode === "local_fallback_after_openclaw_error") return "后端兜底";
  if (mode === "local_empty_message") return "本地空消息";
  if (mode === "local_skill_router") return "后端规则";
  return mode || "";
}

function buildChatDebugTrace(message) {
  if (!message || message.role === "user" || message.isThinking) return null;
  const sourceLabel = sourceLabelForAssistant(message);
  const lines = [];
  if (sourceLabel) lines.push(`来源：${sourceLabel}`);
  if (message.openclaw && message.openclaw.parse_mode) {
    lines.push(`解析：${message.openclaw.parse_mode}`);
  }
  if (message.openclaw && message.openclaw.run_id) {
    lines.push(`Run：${shortRunId(message.openclaw.run_id)}`);
  }
  if (message.openclaw && message.openclaw.error) {
    lines.push(`OpenClaw 异常：${message.openclaw.error}`);
  }
  if (message.openclaw && Array.isArray(message.openclaw.progress)) {
    message.openclaw.progress.forEach((item) => {
      if (item) lines.push(`进度：${item}`);
    });
  }
  if (message.openclaw && Array.isArray(message.openclaw.skill_trace) && message.openclaw.skill_trace.length) {
    message.openclaw.skill_trace.forEach((trace) => {
      const skill = trace.skill || "skill";
      const state = trace.ok ? "完成" : (trace.error || "异常");
      const ids = Array.isArray(trace.merchant_ids) && trace.merchant_ids.length ? ` · ${trace.merchant_ids.join(",")}` : "";
      lines.push(`工具：${skill} ${state}${ids}`);
    });
  }
  if (message.ai && message.ai.provider) {
    lines.push(`AI：${message.ai.provider}`);
  }
  if (message.ai && message.ai.parse_mode) {
    lines.push(`AI解析：${message.ai.parse_mode}`);
  }
  if (message.ai && message.ai.error) {
    lines.push(`AI异常：${message.ai.error}`);
  }
  const skillCalls = Array.isArray(message.agent_skill_calls) ? message.agent_skill_calls : [];
  const skillCards = Array.isArray(message.skill_cards) ? message.skill_cards : [];
  const skillNames = skillCalls.length
    ? skillCalls.map((item) => item.skill).filter(Boolean)
    : skillCards.map((item) => item.skill || item.title).filter(Boolean);
  if (skillNames.length) lines.push(`Skill：${skillNames.join("、")}`);
  if (message.memory_candidate_created_count) {
    lines.push(`记忆候选：${message.memory_candidate_created_count} 条`);
  }
  const memoryOperation = message.memory_operation_result || {};
  if (Array.isArray(memoryOperation.results) && memoryOperation.results.length) {
    memoryOperation.results.forEach((result) => {
      const op = result.operation || "memory";
      const state = result.ok ? (result.result_summary || "完成") : (result.error || "异常");
      lines.push(`记忆操作：${op} ${state}`);
    });
  }
  return lines.length ? {
    source_label: sourceLabel,
    lines
  } : null;
}

function decorateChatMessage(message) {
  if (!message || typeof message !== "object") return message;
  const skillResultCards = Array.isArray(message.skill_result_cards)
    ? message.skill_result_cards.map((card) => ({
      ...card,
      merchants: Array.isArray(card.merchants)
        ? card.merchants.map((merchant) => ({
          ...merchant,
          specialtiesText: Array.isArray(merchant.specialties) ? merchant.specialties.join("、") : ""
        }))
        : card.merchants
    }))
    : message.skill_result_cards;
  return {
    ...message,
    skill_result_cards: skillResultCards,
    debug_trace: buildChatDebugTrace(message)
  };
}

function currentChatContext(data) {
  const currentCard = data.currentCard || null;
  return {
    active_tab: data.activeTab,
    meal_stage: data.stage,
    meal_session_id: data.sessionId || "",
    current_card: currentCard ? {
      merchant_id: currentCard.merchantId || currentCard.merchant_id || "",
      merchant_name: currentCard.merchantName || currentCard.merchant_name || currentCard.title || "",
      title: currentCard.title || "",
      tags: currentCard.tags || [],
      facts: currentCard.facts || {}
    } : null
  };
}

function decorateChatMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map(decorateChatMessage);
}

function latestActionFromChatMessages(messages = [], action) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (!message || message.role === "user") continue;
    const skillCards = Array.isArray(message.skill_cards) ? message.skill_cards : [];
    return skillCards.find((item) => item && item.action === action) || null;
  }
  return null;
}

function todayDayId(userId) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `day_${year}${month}${day}_${userId}`;
}

Page({
  data: {
    activeTab: "chat",
    stage: "entry",
    stageLabel: "问小汪",
    stageSubtitle: "可以聊天，也可以调起滑卡",
    sessionId: "",
    sessionStage: "",
    sessionDebug: {
      api: getApiBaseUrl(),
      memory: "-",
      mode: getApiMode()
    },
    entryForm: {
      partySize: "one",
      budget: "80",
      radius: "near_3km",
      flavor: "any",
      text: "今天有点累，想吃热乎下饭的"
    },
    location: null,
    locationText: "定位中",
    entryOptions: {
      partySize: [
        { value: "one", label: "一个人", text: "一个人" },
        { value: "two", label: "两个人", text: "两个人" },
        { value: "group", label: "多人", text: "多人" }
      ],
      budget: [
        { value: "60", label: "60以内", text: "人均 60 以内" },
        { value: "100", label: "100以内", text: "人均 100 以内" },
        { value: "open", label: "先不限制", text: "预算先不限制" }
      ],
      radius: [
        { value: "near_1km", label: "附近 1km", text: "附近 1km 内" },
        { value: "near_3km", label: "附近 3km", text: "附近 3km 内" },
        { value: "futian", label: "福田内", text: "福田内" }
      ],
      flavor: [
        { value: "any", label: "不限口味", text: "口味不限" },
        { value: "spicy", label: "想吃辣", text: "想吃辣或重口味" },
        { value: "light", label: "清爽点", text: "想吃清爽一点" }
      ]
    },
    goal: "",
    editableGoal: "",
    isEditingGoal: false,
    isGoalUpdating: false,
    cards: [],
    index: 0,
    currentCard: null,
    nextCard: null,
    currentImageUrl: "",
    currentPosterUrl: "",
    videoDisabled: true,
    videoReady: false,
    videoMuted: true,
    videoPaused: false,
    xiaowangMascotUrl: "https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com/assets/mascot/xiaowang-idle-v1.png?v=20260521b",
    xiaowangHeadUrl: "https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com/assets/mascot/xiaowang-head-v1.png?v=20260521a",
    xiaowangSummaryUrl: "https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com/assets/mascot/xiaowang-summary-v1.png?v=20260521a",
    cardStyle: "",
    keepFeedbackStyle: "",
    dislikeFeedbackStyle: "",
    directionEvents: [],
    offerEvents: [],
    directionSummary: null,
    summaryCorrectionOpen: false,
    summaryCorrectionText: "",
    directionCorrectionNotice: "",
    result: null,
    postMealFeedbackText: "",
    postMealResponse: null,
    chatSessionId: "",
    chatMessages: [],
    chatInput: "",
    isChatSubmitting: false,
    diary: null,
    isDiaryLoading: false,
    isDreaming: false,
    editingMemoryCandidateId: "",
    memoryEditText: "",
    diaryError: "",
    isLoading: false,
    loadingText: "",
    bootNotice: "",
    resumableSessionId: "",
    errorText: ""
  },

  onLoad() {
    this.touchStart = null;
    this.swipeTimer = null;
    this.videoTimer = null;
    this.isCommittingSwipe = false;
    this.verticalTouching = false;
    this.offerExplanationRequests = {};
    this.offerExplanationAttempts = {};
    this.currentStartedAt = Date.now();
    this.prepareSessionRestore();
    this.autoLocateOnce();
  },

  onUnload() {
    if (this.swipeTimer) clearTimeout(this.swipeTimer);
    if (this.videoTimer) clearTimeout(this.videoTimer);
  },

  prepareSessionRestore() {
    const sessionId = wx.getStorageSync(STORAGE_SESSION_ID);
    if (!sessionId) return;
    this.setData({
      resumableSessionId: sessionId
    });
  },

  autoLocateOnce() {
    if (this.data.location) return;
    this.getLocation({ silent: true });
  },

  async restoreSession() {
    const sessionId = wx.getStorageSync(STORAGE_SESSION_ID);
    if (!sessionId) return;
    this.setData({ isLoading: true, loadingText: "正在恢复上次饭点..." });
    try {
      const payload = await sessionApi.getSession(sessionId);
      if (payload.session && payload.session.status !== "finalized") {
        this.applySession(payload.session, { notice: "已继续上次未完成的饭点 session" });
      }
    } catch (error) {
      wx.removeStorageSync(STORAGE_SESSION_ID);
      this.setData({ resumableSessionId: "", bootNotice: "" });
    } finally {
      this.setData({ isLoading: false, loadingText: "" });
    }
  },

  selectEntryOption(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.currentTarget.dataset.value;
    if (!field || !value) return;
    this.setData({
      entryForm: {
        ...this.data.entryForm,
        [field]: value
      }
    });
  },

  onEntryTextInput(event) {
    this.setData({
      entryForm: {
        ...this.data.entryForm,
        text: event.detail.value
      }
    });
  },

  onBudgetChange(event) {
    const value = Number(event.detail.value || 0);
    this.setData({
      entryForm: {
        ...this.data.entryForm,
        budget: String(value)
      }
    });
  },

  optionText(field, value) {
    const option = (this.data.entryOptions[field] || []).find((item) => item.value === value);
    return option ? option.text : "";
  },

  budgetText(value) {
    const budget = Number(value);
    if (Number.isFinite(budget) && budget >= 500) return "预算不限";
    if (Number.isFinite(budget) && budget > 0) return `人均 ${budget} 以内`;
    return "预算未定";
  },

  entrySummary(entryForm = this.data.entryForm) {
    return [
      this.optionText("partySize", entryForm.partySize),
      this.budgetText(entryForm.budget),
      this.optionText("radius", entryForm.radius),
      this.optionText("flavor", entryForm.flavor),
      String(entryForm.text || "").trim(),
    ].filter(Boolean).join(" · ");
  },

  buildEntryFormForApi(entryForm = this.data.entryForm) {
    const radiusMap = { near_1km: 1, near_3km: 3, futian: 8 };
    const budgetValue = Number(entryForm.budget);
    const budgetMax = Number.isFinite(budgetValue) && budgetValue >= 500 ? null : budgetValue;
    return {
      party_size: entryForm.partySize === "two" ? 2 : (entryForm.partySize === "group" ? 4 : 1),
      budget_per_person_max: Number.isFinite(budgetMax) && budgetMax > 0 ? budgetMax : null,
      radius_km: radiusMap[entryForm.radius],
      flavor_preference: this.optionText("flavor", entryForm.flavor),
      raw_query: entryForm.text,
      location: this.data.location
    };
  },

  distanceMeters(left, right) {
    const rad = Math.PI / 180;
    const lat1 = Number(left.latitude) * rad;
    const lat2 = Number(right.latitude) * rad;
    const dLat = (Number(right.latitude) - Number(left.latitude)) * rad;
    const dLng = (Number(right.longitude) - Number(left.longitude)) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  locationLabel(location) {
    if (!location) return "定位中";
    const nearest = LOCATION_LANDMARKS
      .map((item) => ({...item, distance: this.distanceMeters(location, item)}))
      .sort((left, right) => left.distance - right.distance)[0];
    if (nearest && nearest.distance <= 2500) return nearest.label;
    return "福田区附近";
  },

  async getLocation(options = {}) {
    this.setData({ locationText: options.silent ? "定位中" : "正在定位" });
    wx.getLocation({
      type: "gcj02",
      success: (res) => {
        const location = {
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: res.accuracy,
          source: "wx.getLocation",
          coordinate_type: "gcj02",
          captured_at: new Date().toISOString()
        };
        this.setData({
          location,
          locationText: this.locationLabel(location)
        });
      },
      fail: (error) => {
        console.warn("[LifePilot] getLocation failed", error);
        const message = error && error.errMsg ? error.errMsg.replace(/^getLocation:fail\s*/i, "") : "未获取到位置";
        this.setData({ locationText: message.includes("auth") || message.includes("authorize") ? "未授权定位" : "福田区 · 默认位置" });
      }
    });
  },

  async startMealFlow() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true, loadingText: "小汪正在理解今天怎么吃...", errorText: "" });
    try {
      const payload = await sessionApi.startSession({
        user_id: DEFAULT_USER_ID,
        entry_form: this.buildEntryFormForApi(),
        location: this.data.location,
        timeout_ms: 30000
      });
      const session = payload.session;
      wx.setStorageSync(STORAGE_SESSION_ID, session.session_id);
      this.applySession(session, { meta: payload.meta });
    } catch (error) {
      this.setData({ errorText: `${error.message || "后端连接失败"}\nAPI: ${getApiBaseUrl()}` });
      wx.showToast({ title: "后端连接失败", icon: "none" });
    } finally {
      this.setData({ isLoading: false, loadingText: "" });
    }
  },

  applySession(session, options = {}) {
    const stage = session.stage || "direction";
    const cards = this.normalizeCardsForStage(stage, session.current_cards || []);
    const directionEvents = session.direction_events || this.data.directionEvents || [];
    const offerEvents = session.offer_events || this.data.offerEvents || [];
    const summary = session.direction_summary ? {
      ...this.buildDirectionSummaryFromEvents(directionEvents),
      text: session.direction_summary.summary_text,
      mode: session.direction_summary.mode,
      timing: session.direction_summary.timing,
      userFeedback: (this.data.directionSummary && this.data.directionSummary.userFeedback) || ""
    } : null;
    const result = session.result ? normalizeResult(session.result) : null;
    const memoryMeta = options.meta && options.meta.memory_context;
    this.setData({
      stage,
      stageLabel: this.labelForStage(stage),
      stageSubtitle: this.subtitleForStage(stage),
      sessionId: session.session_id || this.data.sessionId,
      sessionStage: stage,
      goal: session.goal || this.data.goal,
      editableGoal: this.entrySummary(this.data.entryForm),
      isEditingGoal: false,
      isGoalUpdating: false,
      cards,
      index: 0,
      directionEvents,
      offerEvents,
      directionSummary: summary,
      result,
      sessionDebug: {
        api: getApiBaseUrl(),
        mode: `${getApiMode()} · ${session.schema_version || "session"}`,
        memory: memoryMeta ? `confirmed ${memoryMeta.confirmed_preferences || 0} / evermind ${memoryMeta.evermind_memories || 0}` : this.data.sessionDebug.memory
      },
      bootNotice: options.notice || ""
    }, () => {
      if (stage === "direction" || stage === "offer") this.syncCards();
    });
  },

  normalizeCardsForStage(stage, cards) {
    if (stage === "offer") return cards.map(normalizeOfferCard);
    if (stage === "direction") return cards.map(normalizeDirectionCard);
    return [];
  },

  labelForStage(stage) {
    const labels = {
      entry: "入口",
      direction: "方向选择",
      direction_summary: "方向小结",
      offer: "商户选择",
      final: "最终确认"
    };
    return labels[stage] || "饭点";
  },

  subtitleForStage(stage) {
    const subtitles = {
      entry: "先告诉小汪今天想怎么吃",
      direction: "右滑保留，左滑放弃",
      direction_summary: "小汪先收窄口味边界",
      offer: "继续筛具体商家",
      final: "吃完以后可以反馈给小汪"
    };
    return subtitles[stage] || "";
  },

  syncCards() {
    const currentCard = this.data.cards[this.data.index] || null;
    const nextCard = this.data.cards[this.data.index + 1] || null;
    this.currentStartedAt = Date.now();
    this._videoContext = null;
    this.setData({
      currentCard,
      nextCard,
      currentImageUrl: currentCard ? currentCard.imageUrl : "",
      currentPosterUrl: currentCard ? (currentCard.posterUrl || currentCard.imageUrl) : "",
      cardStyle: "",
      keepFeedbackStyle: "",
      dislikeFeedbackStyle: "",
      videoDisabled: true,
      videoReady: false,
      videoPaused: false,
      videoMuted: this.data.stage === "offer" ? false : this.data.videoMuted
    }, () => {
      this.enableVideoSoon();
      this.prefetchOfferExplanations();
    });
  },

  startGoalEdit() {
    if (this.data.stage !== "direction") return;
    this.setData({
      isEditingGoal: true,
      editableGoal: this.data.editableGoal || this.entrySummary()
    });
  },

  cancelGoalEdit() {
    this.setData({ isEditingGoal: false });
  },

  onEditableGoalInput(event) {
    this.setData({ editableGoal: event.detail.value });
  },

  async applyGoalEdit() {
    const text = String(this.data.editableGoal || "").trim();
    if (!text || this.data.isGoalUpdating || !this.data.sessionId) return;
    const entryForm = {
      ...this.data.entryForm,
      text,
      raw_query: text,
      location: this.data.location
    };
    this.setData({ isGoalUpdating: true, isLoading: true, loadingText: "小汪正在重新理解需求..." });
    try {
      const payload = await sessionApi.updateSessionEntry({
        session_id: this.data.sessionId,
        entry_form: this.buildEntryFormForApi(entryForm),
        location: this.data.location,
        timeout_ms: 30000
      });
      this.setData({ entryForm });
      this.applySession(payload.session, { meta: payload.meta });
    } catch (error) {
      wx.showToast({ title: "需求更新失败", icon: "none" });
    } finally {
      this.setData({ isGoalUpdating: false, isLoading: false, loadingText: "" });
    }
  },

  prefetchOfferExplanations() {
    if (this.data.stage !== "offer" || !this.data.sessionId) return;
    const upcoming = this.data.cards.slice(this.data.index, this.data.index + 5).filter(Boolean);
    upcoming.forEach((card) => this.prefetchOfferExplanation(card));
  },

  async prefetchOfferExplanation(card) {
    if (!card || card.cardType !== "offer" || card.aiExplanationMode === "ark") return;
    const key = card.offerId || card.cardId;
    if (!key || this.offerExplanationRequests[key]) return;
    const attempts = this.offerExplanationAttempts[key] || 0;
    if (attempts >= 2) return;
    this.offerExplanationRequests[key] = true;
    this.offerExplanationAttempts[key] = attempts + 1;
    try {
      const payload = await sessionApi.explainOfferCard({
        session_id: this.data.sessionId,
        offer_id: card.offerId,
        card_id: card.cardId,
        offer_ai_timeout_ms: 15000
      });
      if (!payload.card) return;
      const normalized = normalizeOfferCard(payload.card, card.order);
      const cards = this.data.cards.map((item) => (
        item.offerId === normalized.offerId ? normalized : item
      ));
      if (normalized.aiExplanationMode !== "ark") {
        this.offerExplanationRequests[key] = false;
      }
      const currentCard = cards[this.data.index] || null;
      const nextCard = cards[this.data.index + 1] || null;
      this.setData({
        cards,
        currentCard,
        nextCard
      }, () => this.prefetchOfferExplanations());
    } catch (error) {
      this.offerExplanationRequests[key] = false;
    }
  },

  enableVideoSoon() {
    if (this.videoTimer) clearTimeout(this.videoTimer);
    const card = this.data.currentCard;
    if (!card || !card.videoUrl) return;
    this.videoTimer = setTimeout(() => {
      this.videoTimer = null;
      if (this.data.currentCard && this.data.currentCard.videoUrl === card.videoUrl) {
        this.setData({ videoDisabled: false, videoPaused: false });
      }
    }, this.data.stage === "offer" ? 900 : 700);
  },

  onVideoReady() {
    this.setData({ videoReady: true });
    this.videoContext().play();
  },

  onVideoError() {
    this.setData({ videoDisabled: true, videoReady: false });
  },

  toggleVideoMuted() {
    const muted = !this.data.videoMuted;
    this.skipNextVideoTap = true;
    this.setData({ videoMuted: muted, videoPaused: false }, () => {
      this.videoContext().play();
    });
  },

  videoContext() {
    if (!this._videoContext) this._videoContext = wx.createVideoContext("currentFoodVideo", this);
    return this._videoContext;
  },

  toggleVideoPlay() {
    if (this.data.videoDisabled || !this.data.currentCard || !this.data.currentCard.videoUrl) return;
    const paused = !this.data.videoPaused;
    const context = this.videoContext();
    if (paused) {
      context.pause();
    } else {
      context.play();
    }
    this.setData({ videoPaused: paused });
  },

  onImageError() {
    console.warn("[LifePilot] image load failed");
  },

  onTouchStart(event) {
    if (this.isCommittingSwipe || !this.data.currentCard) return;
    const touch = event.touches[0];
    this.touchStart = { x: touch.clientX, y: touch.clientY };
    this.verticalTouching = false;
  },

  onTouchMove(event) {
    if (!this.touchStart || this.isCommittingSwipe) return;
    const touch = event.touches[0];
    const dx = touch.clientX - this.touchStart.x;
    const dy = touch.clientY - this.touchStart.y;
    if (this.data.stage === "offer" && Math.abs(dy) > Math.abs(dx) + 8) {
      this.verticalTouching = true;
      return;
    }
    if (this.verticalTouching) return;
    this.setData(swipeGesture.dragStyles(dx, dy));
  },

  onTouchEnd(event) {
    if (!this.touchStart || this.isCommittingSwipe) return;
    const touch = event.changedTouches[0] || {};
    const dx = (touch.clientX || this.touchStart.x) - this.touchStart.x;
    const dy = (touch.clientY || this.touchStart.y) - this.touchStart.y;
    this.touchStart = null;
    if (this.data.stage === "offer" && (this.verticalTouching || Math.abs(dy) > Math.abs(dx) + 10)) {
      this.verticalTouching = false;
      return;
    }
    this.verticalTouching = false;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      if (this.skipNextVideoTap) {
        this.skipNextVideoTap = false;
      } else {
        this.toggleVideoPlay();
      }
      this.setData(swipeGesture.resetStyles());
      return;
    }
    if (dx > 70) {
      this.commitSwipe("keep");
      return;
    }
    if (dx < -70) {
      this.commitSwipe("dislike");
      return;
    }
    this.setData(swipeGesture.resetStyles());
  },

  onKeep() {
    this.commitSwipe("keep");
  },

  onDislike() {
    this.commitSwipe("dislike");
  },

  commitSwipe(action) {
    if (!this.data.currentCard || this.isCommittingSwipe) return;
    this.isCommittingSwipe = true;
    this.setData(swipeGesture.flyStyles(action));
    this.swipeTimer = setTimeout(() => {
      this.swipeTimer = null;
      this.recordSwipe(action);
    }, 150);
  },

  async recordSwipe(action, options = {}) {
    const card = this.data.currentCard;
    if (!card) {
      this.isCommittingSwipe = false;
      return;
    }
    const event = this.buildSwipeEvent(card, action);
    try {
      await sessionApi.swipeSession({
        session_id: this.data.sessionId,
        action,
        card_id: card.cardId,
        direction_id: card.directionId,
        offer_id: card.offerId,
        merchant_id: card.merchantId,
        dwell_ms: Date.now() - this.currentStartedAt
      });
    } catch (error) {
      wx.showToast({ title: error.message || "滑卡同步失败", icon: "none" });
    }

    if (card.cardType === "direction") {
      this.setData({ directionEvents: this.data.directionEvents.concat(event) });
      this.advanceLocalCardStack(() => {
        if (!this.data.currentCard) this.loadDirectionSummary();
      });
    } else {
      this.setData({ offerEvents: this.data.offerEvents.concat(event) });
      this.advanceLocalCardStack(() => {
        if (options.finalizeAfterOffer !== false && !this.data.currentCard) this.finalizeMeal();
      });
    }
  },

  buildSwipeEvent(card, action) {
    return {
      action,
      card_type: card.cardType,
      title: card.cardType === "offer" ? `${card.title} · ${card.dishTitle}` : card.title,
      card_id: card.cardId,
      direction_id: card.directionId || "",
      offer_id: card.offerId || "",
      merchant_id: card.merchantId || "",
      tags: card.tags || [],
      created_at: new Date().toISOString()
    };
  },

  listText(items, emptyText) {
    const names = (items || []).map((item) => String(item.title || "").trim()).filter(Boolean);
    if (!names.length) return emptyText;
    const visible = names.slice(0, 6);
    const hiddenCount = names.length - visible.length;
    return hiddenCount > 0 ? `${visible.join("、")}等 ${names.length} 个方向` : visible.join("、");
  },

  topTags(events = []) {
    const counts = {};
    events.forEach((event) => {
      (event.tags || []).forEach((tag) => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.keys(counts)
      .sort((left, right) => counts[right] - counts[left])
      .slice(0, 4)
      .join("、");
  },

  buildDirectionSummaryFromEvents(events = this.data.directionEvents) {
    const kept = events.filter((event) => event.action === "keep");
    const disliked = events.filter((event) => event.action === "dislike");
    const keptTagText = this.topTags(kept);
    return {
      keptText: this.listText(kept, "还没有特别保留的方向"),
      dislikedText: this.listText(disliked, "暂时没有明确排除"),
      intentText: keptTagText
        ? `我会优先看 ${keptTagText} 的具体选择。`
        : "我会先从低冲突、适合一个人的具体选择里继续筛。",
      keptCount: kept.length,
      dislikedCount: disliked.length
    };
  },

  advanceLocalCardStack(done) {
    const nextIndex = this.data.index + 1;
    this.isCommittingSwipe = false;
    this.setData({ index: nextIndex }, () => {
      this.syncCards();
      if (typeof done === "function") done();
    });
  },

  async loadDirectionSummary() {
    if (this.data.isLoading || !this.data.sessionId) return;
    this.setData({
      stage: "direction_summary_loading",
      stageLabel: "方向小结",
      directionSummary: this.buildDirectionSummaryFromEvents(),
      summaryCorrectionOpen: false,
      summaryCorrectionText: "",
      directionCorrectionNotice: "",
      isLoading: true,
      loadingText: "小汪正在总结刚刚的选择..."
    });
    try {
      const payload = await sessionApi.advanceSession({
        session_id: this.data.sessionId,
        timeout_ms: 30000
      });
      const session = payload.session;
      this.applySession(session, { meta: payload.meta });
      this.setData({ stage: "direction_summary", stageLabel: "方向小结", stageSubtitle: "小汪先收窄口味边界" });
    } catch (error) {
      this.setData({ errorText: error.message || "方向小结失败" });
      wx.showToast({ title: "方向小结失败", icon: "none" });
    } finally {
      this.setData({ isLoading: false, loadingText: "" });
    }
  },

  markDirectionSummaryOk() {
    this.setData({
      directionCorrectionNotice: "好，小汪就按这个理解继续找商家。",
      summaryCorrectionOpen: false,
      summaryCorrectionText: ""
    });
  },

  openDirectionCorrectionInput() {
    this.setData({
      summaryCorrectionOpen: true,
      directionCorrectionNotice: ""
    });
  },

  onDirectionCorrectionInput(event) {
    this.setData({ summaryCorrectionText: event.detail.value || "" });
  },

  applyDirectionCorrection() {
    const text = String(this.data.summaryCorrectionText || "").trim();
    if (!text) return;
    this.setData({
      directionSummary: {
        ...(this.data.directionSummary || {}),
        userFeedback: text
      },
      directionCorrectionNotice: `收到，主人补充：${text}`,
      summaryCorrectionOpen: false,
      summaryCorrectionText: ""
    });
  },

  async continueToOffers() {
    if (this.data.isLoading || !this.data.sessionId) return;
    this.setData({ isLoading: true, loadingText: "小汪正在筛具体商家..." });
    try {
      const payload = await sessionApi.advanceSession({
        session_id: this.data.sessionId,
        direction_summary: {
          ...(this.data.directionSummary || {}),
          user_feedback: (this.data.directionSummary && this.data.directionSummary.userFeedback) || ""
        },
        ai_explanations: true,
        offer_ai_timeout_ms: 7000,
        offer_ai_max_attempts: 1,
        offer_ai_per_card_count: 1,
        limit: 10
      });
      this.applySession(payload.session);
    } catch (error) {
      this.setData({ errorText: error.message || "商户卡生成失败" });
      wx.showToast({ title: "商户卡生成失败", icon: "none" });
    } finally {
      this.setData({ isLoading: false, loadingText: "" });
    }
  },

  async chooseCurrentOffer() {
    if (!this.data.currentCard || this.data.stage !== "offer") return;
    await this.recordSwipe("keep", {finalizeAfterOffer: false});
    await this.finalizeMeal();
  },

  async finalizeMeal() {
    if (this.data.isLoading || !this.data.sessionId) return;
    this.setData({ isLoading: true, loadingText: "小汪正在整理最终建议..." });
    try {
      const payload = await sessionApi.finalizeSession({
        session_id: this.data.sessionId
      });
      const result = normalizeResult(payload.result || (payload.session && payload.session.result) || {});
      this.setData({
        stage: "final",
        stageLabel: "最终确认",
        stageSubtitle: "吃完以后可以反馈给小汪",
        sessionStage: "final",
        result,
        postMealFeedbackText: "",
        postMealResponse: null
      });
      wx.removeStorageSync(STORAGE_SESSION_ID);
    } catch (error) {
      this.setData({ errorText: error.message || "最终确认失败" });
      wx.showToast({ title: "最终确认失败", icon: "none" });
    } finally {
      this.setData({ isLoading: false, loadingText: "" });
    }
  },

  onFeedbackInput(event) {
    this.setData({ postMealFeedbackText: event.detail.value });
  },

  async submitPostMealFeedback() {
    const text = String(this.data.postMealFeedbackText || "").trim();
    const primary = this.data.result && this.data.result.primary;
    if (!text || !primary) return;
    this.setData({ isLoading: true, loadingText: "小汪正在记录这次体验..." });
    try {
      const payload = await memoryApi.postMealFeedback({
        user_id: DEFAULT_USER_ID,
        session_id: this.data.sessionId,
        offer_id: primary.offerId,
        merchant_id: primary.merchantId,
        merchant_name: primary.title,
        feedback_text: text
      });
      this.setData({
        postMealResponse: {
          createdCount: payload.created_count || 0,
          merchantFeedback: payload.merchant_feedback || null
        }
      });
      wx.showToast({ title: payload.created_count ? "已生成待确认记忆" : "已记录反馈", icon: "none" });
    } catch (error) {
      wx.showToast({ title: "反馈提交失败", icon: "none" });
    } finally {
      this.setData({ isLoading: false, loadingText: "" });
    }
  },

  switchMainTab(event) {
    const tab = event.currentTarget.dataset.tab || "meal";
    const next = {
      activeTab: tab,
      errorText: tab === "meal" ? this.data.errorText : ""
    };
    if (tab === "meal") {
      next.stageLabel = this.labelForStage(this.data.stage);
      next.stageSubtitle = this.subtitleForStage(this.data.stage);
    } else if (tab === "chat") {
      next.stageLabel = "问小汪";
      next.stageSubtitle = "可以聊天，也可以调起滑卡";
    } else if (tab === "diary") {
      next.stageLabel = "小汪日记本";
      next.stageSubtitle = "今天的吃饭记录和待确认记忆";
    }
    this.setData(next, () => {
      if (tab === "diary" && !this.data.diary) this.loadXiaowangDiary();
    });
  },

  onChatInput(event) {
    this.setData({ chatInput: event.detail.value || "" });
  },

  async submitXiaowangChat() {
    const text = String(this.data.chatInput || "").trim();
    if (!text || this.data.isChatSubmitting) return;
    const localUserMessage = {
      id: `local_${Date.now()}`,
      role: "user",
      content: text,
      skill_cards: []
    };
    const thinkingMessage = {
      id: `thinking_${Date.now()}`,
      role: "assistant",
      content: "小汪正在想...",
      isThinking: true,
      skill_cards: []
    };
    this.setData({
      chatInput: "",
      isChatSubmitting: true,
      chatMessages: this.data.chatMessages.concat(
        decorateChatMessage(localUserMessage),
        decorateChatMessage(thinkingMessage)
      )
    });
    try {
      const payload = await xiaowangApi.chatAsync({
        user_id: DEFAULT_USER_ID,
        session_id: this.data.chatSessionId,
        message: text,
        current_context: currentChatContext(this.data)
      });
      const pendingAssistant = payload.pending_assistant || {
        ...thinkingMessage,
        content: "小汪开始思考了...",
        isThinking: false,
        mode: "openclaw_pending",
        openclaw: { status: "running", progress: ["已提交后台任务"] }
      };
      this.setData({
        chatMessages: this.data.chatMessages.map((item) => (
          item.id === thinkingMessage.id ? decorateChatMessage({ ...pendingAssistant, isThinking: false }) : item
        )),
        diary: null,
        isChatSubmitting: false
      });
      if (payload.job_id) this.pollXiaowangChatJob(payload.job_id, thinkingMessage.id, Date.now());
    } catch (error) {
      const messages = this.data.chatMessages.map((item) => (
        item.id === thinkingMessage.id
          ? {
            ...item,
            content: this.formatRequestError(error, "小汪暂时连不上后端。"),
            isThinking: false
          }
          : item
      ));
      this.setData({
        chatMessages: messages
      });
      wx.showToast({ title: "问小汪失败", icon: "none" });
    } finally {
      if (!this.activeChatJobId) this.setData({ isChatSubmitting: false });
    }
  },

  pollXiaowangChatJob(jobId, pendingMessageId, startedAt) {
    this.activeChatJobId = jobId;
    const maxMs = 120000;
    const tick = async () => {
      if (this.activeChatJobId !== jobId) return;
      try {
        const payload = await xiaowangApi.getChatJob(jobId);
        if (payload.status === "completed" && payload.result) {
          this.activeChatJobId = "";
          const nextMessages = decorateChatMessages(payload.result.messages || this.data.chatMessages);
          this.setData({
            chatSessionId: payload.result.session && payload.result.session.session_id ? payload.result.session.session_id : this.data.chatSessionId,
            chatMessages: nextMessages,
            diary: null,
            isChatSubmitting: false
          }, () => {
            this.handleCompletedChatActions(nextMessages);
          });
          return;
        }
        if (payload.status === "failed") {
          throw new Error(payload.error || "问小汪后台任务失败");
        }
        if (Date.now() - startedAt > maxMs) {
          throw new Error("小汪这次思考太久了，先停在这里");
        }
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        this.setData({
          chatMessages: this.data.chatMessages.map((item) => (
            item.id === pendingMessageId || item.id === `pending_${jobId}`
              ? decorateChatMessage({
                ...item,
                isThinking: false,
                openclaw: {
                  ...(item.openclaw || {}),
                  status: "running",
                  progress: [
                    "OpenClaw 仍在处理",
                    `${elapsed}s：等待 skill 判断或工具结果`
                  ]
                }
              })
              : item
          ))
        });
        setTimeout(tick, 2000);
      } catch (error) {
        this.activeChatJobId = "";
        this.setData({
          chatMessages: this.data.chatMessages.map((item) => (
            item.id === pendingMessageId || item.id === `pending_${jobId}`
              ? decorateChatMessage({
                ...item,
                content: this.formatRequestError(error, "问小汪失败"),
                isThinking: false,
                mode: "openclaw_pending_failed",
                openclaw: {
                  ...(item.openclaw || {}),
                  status: "failed",
                  error: error.message || "poll_failed"
                }
              })
              : item
          )),
          isChatSubmitting: false
        });
        wx.showToast({ title: "问小汪失败", icon: "none" });
      }
    };
    setTimeout(tick, 1200);
  },

  formatRequestError(error, fallback) {
    const message = error && error.message ? error.message : fallback;
    if (error && error.apiBaseUrl) {
      return `${message}\nAPI: ${error.apiBaseUrl}`;
    }
    return message;
  },

  handleCompletedChatActions(messages) {
    const startMealCard = latestActionFromChatMessages(messages, "start_meal");
    if (startMealCard) {
      this.startMealSkill();
    }
  },

  runChatSkill(event) {
    const action = event.currentTarget.dataset.action;
    if (action === "start_meal") {
      this.startMealSkill();
      return;
    }
    if (action === "open_diary" || action === "review_memory") {
      this.switchMainTab({ currentTarget: { dataset: { tab: "diary" } } });
      return;
    }
    if (action === "run_dreaming") {
      this.runXiaowangDreaming();
    }
  },

  startMealSkill() {
    this.setData({
      activeTab: "meal",
      stageLabel: this.labelForStage(this.data.stage),
      stageSubtitle: this.subtitleForStage(this.data.stage)
    }, () => {
      if (this.data.stage === "entry") {
        this.startMealFlow();
      }
    });
  },

  async loadXiaowangDiary() {
    if (this.data.isDiaryLoading) return;
    this.setData({ isDiaryLoading: true, diaryError: "" });
    try {
      const payload = await xiaowangApi.getDiary({ user_id: DEFAULT_USER_ID });
      this.setData({ diary: payload, editingMemoryCandidateId: "", memoryEditText: "" });
    } catch (error) {
      this.setData({ diaryError: error.message || "日记本加载失败" });
    } finally {
      this.setData({ isDiaryLoading: false });
    }
  },

  async confirmDiaryCandidate(event) {
    const candidateId = event.currentTarget.dataset.id;
    if (!candidateId) return;
    this.setData({ isDiaryLoading: true });
    try {
      const data = { user_id: DEFAULT_USER_ID, actor: "user" };
      if (this.data.editingMemoryCandidateId === candidateId && String(this.data.memoryEditText || "").trim()) {
        data.confirmation_text = String(this.data.memoryEditText || "").trim();
      }
      await memoryApi.confirmCandidate(candidateId, data);
      wx.showToast({ title: "小汪已记住", icon: "none" });
      this.setData({ isDiaryLoading: false });
      await this.loadXiaowangDiary();
    } catch (error) {
      wx.showToast({ title: "确认失败", icon: "none" });
      this.setData({ isDiaryLoading: false });
    } finally {
      if (this.data.isDiaryLoading) this.setData({ isDiaryLoading: false });
    }
  },

  async rejectDiaryCandidate(event) {
    const candidateId = event.currentTarget.dataset.id;
    if (!candidateId) return;
    this.setData({ isDiaryLoading: true });
    try {
      await memoryApi.rejectCandidate(candidateId, { user_id: DEFAULT_USER_ID, actor: "user", reason: "user_reject_from_diary" });
      wx.showToast({ title: "已先不记", icon: "none" });
      this.setData({ isDiaryLoading: false });
      await this.loadXiaowangDiary();
    } catch (error) {
      wx.showToast({ title: "忽略失败", icon: "none" });
      this.setData({ isDiaryLoading: false });
    } finally {
      if (this.data.isDiaryLoading) this.setData({ isDiaryLoading: false });
    }
  },

  startEditDiaryCandidate(event) {
    const candidateId = event.currentTarget.dataset.id;
    const text = event.currentTarget.dataset.text || "";
    this.setData({
      editingMemoryCandidateId: candidateId,
      memoryEditText: text
    });
  },

  cancelEditDiaryCandidate() {
    this.setData({
      editingMemoryCandidateId: "",
      memoryEditText: ""
    });
  },

  onMemoryEditInput(event) {
    this.setData({ memoryEditText: event.detail.value || "" });
  },

  async runXiaowangDreaming() {
    if (this.data.isDreaming) return;
    const dayId = this.data.diary && this.data.diary.day_id ? this.data.diary.day_id : todayDayId(DEFAULT_USER_ID);
    this.setData({ isDreaming: true });
    wx.showToast({ title: "小汪开始复盘", icon: "none" });
    try {
      const payload = await xiaowangApi.runDreaming({
        user_id: DEFAULT_USER_ID,
        day_id: dayId,
        api_base: getApiBaseUrl(),
        transport: "gateway_client",
        local: false,
        timeout_seconds: 240
      });
      wx.showToast({ title: payload.run && payload.run.ok ? "复盘完成" : "复盘已返回", icon: "none" });
      await this.loadXiaowangDiary();
    } catch (error) {
      wx.showToast({ title: error.message || "复盘失败", icon: "none" });
    } finally {
      this.setData({ isDreaming: false });
    }
  },

  resetFlow() {
    wx.removeStorageSync(STORAGE_SESSION_ID);
    this.setData({
      stage: "entry",
      stageLabel: "饭点",
      stageSubtitle: "先告诉小汪今天想怎么吃",
      sessionId: "",
      sessionStage: "",
      goal: "",
      editableGoal: "",
      isEditingGoal: false,
      isGoalUpdating: false,
      cards: [],
      index: 0,
      currentCard: null,
      nextCard: null,
      directionEvents: [],
      offerEvents: [],
      directionSummary: null,
      result: null,
      errorText: "",
      bootNotice: "",
      resumableSessionId: ""
    });
  }
});
