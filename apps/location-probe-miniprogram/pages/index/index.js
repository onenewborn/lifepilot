Page({
  data: {
    apiBaseUrl: "http://127.0.0.1:4331",
    authStatus: "检查中",
    loading: false,
    location: null,
    locationText: "",
    chosenLocation: null,
    chosenLocationText: "",
    error: "",
    logs: []
  },

  onLoad() {
    this.checkSetting();
  },

  checkSetting() {
    wx.getSetting({
      success: (res) => {
        const granted = res.authSetting["scope.userLocation"];
        this.setData({
          authStatus: granted === true ? "已授权" : granted === false ? "已拒绝" : "未请求"
        });
      },
      fail: (error) => {
        this.appendLog("getSetting 失败", error);
        this.setData({ authStatus: "检查失败" });
      }
    });
  },

  getCurrentLocation() {
    this.setData({ loading: true, error: "" });
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      highAccuracyExpireTime: 3000,
      success: (res) => {
        const location = {
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: res.accuracy,
          altitude: res.altitude,
          verticalAccuracy: res.verticalAccuracy,
          horizontalAccuracy: res.horizontalAccuracy,
          speed: res.speed,
          source: "wx.getLocation",
          coordinate_type: "gcj02",
          captured_at: new Date().toISOString()
        };
        this.setData({
          location,
          locationText: JSON.stringify(location, null, 2),
          loading: false,
          authStatus: "已授权"
        });
        this.appendLog("getLocation 成功", location);
        this.reportLocation({ kind: "current", location });
      },
      fail: (error) => {
        this.setData({
          loading: false,
          error: error.errMsg || JSON.stringify(error),
          authStatus: error.errMsg && error.errMsg.includes("auth") ? "已拒绝" : this.data.authStatus
        });
        this.appendLog("getLocation 失败", error);
      }
    });
  },

  chooseLocation() {
    this.setData({ loading: true, error: "" });
    wx.chooseLocation({
      success: (res) => {
        const chosenLocation = {
          name: res.name,
          address: res.address,
          latitude: res.latitude,
          longitude: res.longitude,
          source: "wx.chooseLocation",
          coordinate_type: "gcj02",
          captured_at: new Date().toISOString()
        };
        this.setData({
          chosenLocation,
          chosenLocationText: JSON.stringify(chosenLocation, null, 2),
          loading: false
        });
        this.appendLog("chooseLocation 成功", chosenLocation);
        this.reportLocation({ kind: "chosen", location: chosenLocation });
      },
      fail: (error) => {
        this.setData({ loading: false, error: error.errMsg || JSON.stringify(error) });
        this.appendLog("chooseLocation 失败", error);
      }
    });
  },

  openSetting() {
    wx.openSetting({
      success: () => this.checkSetting(),
      fail: (error) => this.appendLog("openSetting 失败", error)
    });
  },

  copyPayload() {
    const payload = {
      location: this.data.location,
      chosenLocation: this.data.chosenLocation
    };
    wx.setClipboardData({
      data: JSON.stringify(payload, null, 2)
    });
  },

  reportLocation(payload) {
    wx.request({
      url: `${this.data.apiBaseUrl}/api/location/probe`,
      method: "POST",
      data: {
        ...payload,
        client: "location-probe-miniprogram"
      },
      success: (res) => {
        this.appendLog("上报后端成功", res.data);
      },
      fail: (error) => {
        this.appendLog("上报后端失败", {
          error,
          hint: "确认本地后端已启动：npm run dev"
        });
      }
    });
  },

  appendLog(label, payload) {
    const item = {
      time: new Date().toLocaleTimeString(),
      label,
      payload: JSON.stringify(payload, null, 2)
    };
    this.setData({ logs: [item, ...this.data.logs].slice(0, 8) });
  }
});
