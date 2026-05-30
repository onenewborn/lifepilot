const sessionApi = require("../../services/session-api");
const memoryApi = require("../../services/memory-api");
const { normalizeDirectionCard, normalizeOfferCard, normalizeResult } = require("../../utils/card-normalizer");
const swipeGesture = require("../../utils/swipe-gesture");

const STORAGE_SESSION_ID = "lifepilot.activeSessionId";
const DEFAULT_USER_ID = "demo_weiyingru";

Page({
  data: {
    stage: "entry",
    stageLabel: "入口",
    stageSubtitle: "先说今天怎么吃",
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
    locationText: "还没有获取位置",
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
    cards: [],
    index: 0,
    currentCard: null,
    nextCard: null,
    currentImageUrl: "",
    currentPosterUrl: "",
    videoDisabled: true,
    videoReady: false,
    videoMuted: true,
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
    errorText: ""
  },

  onLoad() {
    this.touchStart = null;
    this.swipeTimer = null;
    this.videoTimer = null;
    this.isCommittingSwipe = false;
    this.currentStartedAt = Date.now();
    this.restoreSession();
  },

  onUnload() {
    if (this.swipeTimer) clearTimeout(this.swipeTimer);
    if (this.videoTimer) clearTimeout(this.videoTimer);
  },

  async restoreSession() {
    const sessionId = wx.getStorageSync(STORAGE_SESSION_ID);
    if (!sessionId) return;
    try {
      const payload = await sessionApi.getSession(sessionId);
      if (payload.session && payload.session.status !== "finalized") {
        this.applySession(payload.session, { notice: "已恢复上次未完成的饭点 session" });
      }
    } catch (error) {
      wx.removeStorageSync(STORAGE_SESSION_ID);
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

  buildEntryFormForApi() {
    const { entryForm } = this.data;
    const radiusMap = { near_1km: 1, near_3km: 3, futian: 8 };
    const budgetValue = Number(entryForm.budget);
    return {
      party_size: entryForm.partySize === "two" ? 2 : (entryForm.partySize === "group" ? 4 : 1),
      budget_per_person_max: Number.isFinite(budgetValue) && budgetValue > 0 ? budgetValue : null,
      radius_km: radiusMap[entryForm.radius],
      flavor_preference: this.optionText("flavor", entryForm.flavor),
      raw_query: entryForm.text,
      location: this.data.location
    };
  },

  async getLocation() {
    this.setData({ locationText: "正在获取位置..." });
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
          locationText: `${Number(res.latitude).toFixed(5)}, ${Number(res.longitude).toFixed(5)}`
        });
      },
      fail: () => {
        this.setData({ locationText: "定位失败，会用默认位置继续" });
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
      entry: "先说今天怎么吃",
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
      videoMuted: this.data.stage === "offer" ? false : this.data.videoMuted
    }, () => {
      this.enableVideoSoon();
    });
  },

  enableVideoSoon() {
    if (this.videoTimer) clearTimeout(this.videoTimer);
    const card = this.data.currentCard;
    if (!card || !card.videoUrl) return;
    this.videoTimer = setTimeout(() => {
      this.videoTimer = null;
      if (this.data.currentCard && this.data.currentCard.videoUrl === card.videoUrl) {
        this.setData({ videoDisabled: false });
      }
    }, this.data.stage === "offer" ? 900 : 700);
  },

  onVideoReady() {
    this.setData({ videoReady: true });
  },

  onVideoError() {
    this.setData({ videoDisabled: true, videoReady: false });
  },

  toggleVideoMuted() {
    this.setData({ videoMuted: !this.data.videoMuted });
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
        offer_ai_timeout_ms: 45000,
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
      stageLabel: "入口",
      stageSubtitle: "先说今天怎么吃",
      sessionId: "",
      sessionStage: "",
      cards: [],
      index: 0,
      currentCard: null,
      nextCard: null,
      directionEvents: [],
      offerEvents: [],
      directionSummary: null,
      result: null,
      errorText: "",
      bootNotice: ""
    });
  }
});
