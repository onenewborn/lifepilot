const sessionApi = require("../../services/session-api");
const memoryApi = require("../../services/memory-api");
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

Page({
  data: {
    stage: "entry",
    stageLabel: "饭点",
    stageSubtitle: "先告诉小汪今天想怎么吃",
    sessionId: "",
    sessionStage: "",
    sessionDebug: {
      api: "4331",
      memory: "-",
      mode: "ready"
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
    result: null,
    postMealFeedbackText: "",
    postMealResponse: null,
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
    this.offerExplanationRequests = {};
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
      this.setData({ errorText: error.message || "后端连接失败" });
      wx.showToast({ title: "后端连接失败", icon: "none" });
    } finally {
      this.setData({ isLoading: false, loadingText: "" });
    }
  },

  applySession(session, options = {}) {
    const stage = session.stage || "direction";
    const cards = this.normalizeCardsForStage(stage, session.current_cards || []);
    const summary = session.direction_summary ? {
      text: session.direction_summary.summary_text,
      mode: session.direction_summary.mode,
      timing: session.direction_summary.timing
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
      directionSummary: summary,
      result,
      sessionDebug: {
        api: "4331",
        mode: session.schema_version || "session",
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
    const upcoming = [this.data.currentCard, this.data.nextCard].filter(Boolean);
    upcoming.forEach((card) => this.prefetchOfferExplanation(card));
  },

  async prefetchOfferExplanation(card) {
    if (!card || card.cardType !== "offer" || card.aiExplanationMode === "ark") return;
    const key = card.offerId || card.cardId;
    if (!key || this.offerExplanationRequests[key]) return;
    this.offerExplanationRequests[key] = true;
    try {
      const payload = await sessionApi.explainOfferCard({
        session_id: this.data.sessionId,
        offer_id: card.offerId,
        card_id: card.cardId,
        offer_ai_timeout_ms: 7000
      });
      if (!payload.card) return;
      const normalized = normalizeOfferCard(payload.card, card.order);
      const cards = this.data.cards.map((item) => (
        item.offerId === normalized.offerId ? normalized : item
      ));
      this.setData({ cards }, () => this.syncCards());
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
    const context = this.videoContext();
    if (muted && context.mute) context.mute();
    if (!muted && context.play) context.play();
    this.setData({ videoMuted: muted, videoPaused: false });
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
  },

  onTouchMove(event) {
    if (!this.touchStart || this.isCommittingSwipe) return;
    const touch = event.touches[0];
    const dx = touch.clientX - this.touchStart.x;
    const dy = touch.clientY - this.touchStart.y;
    this.setData(swipeGesture.dragStyles(dx, dy));
  },

  onTouchEnd(event) {
    if (!this.touchStart || this.isCommittingSwipe) return;
    const touch = event.changedTouches[0] || {};
    const dx = (touch.clientX || this.touchStart.x) - this.touchStart.x;
    this.touchStart = null;
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

  async recordSwipe(action) {
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
      this.advanceLocalCardStack();
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
      created_at: new Date().toISOString()
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
    this.setData({ stage: "direction_summary_loading", stageLabel: "方向小结", isLoading: true, loadingText: "小汪正在总结刚刚的选择..." });
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

  async continueToOffers() {
    if (this.data.isLoading || !this.data.sessionId) return;
    this.setData({ isLoading: true, loadingText: "小汪正在筛具体商家..." });
    try {
      const payload = await sessionApi.advanceSession({
        session_id: this.data.sessionId,
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
    await this.recordSwipe("keep");
    this.finalizeMeal();
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
