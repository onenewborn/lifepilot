# 定位能力测试小程序

这个小程序只用于验证开发版环境是否能调用微信定位能力，不接入正式饭点流程。

## 使用方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录优先选择：

   `/Users/mona/Documents/lifepilot/apps/location-probe-miniprogram`

   如果开发者工具提示根目录找不到 `app.json`，就改选：

   `/Users/mona/Documents/lifepilot`

   根目录的 `project.config.json` 已经指向这个定位探针。

4. 如果你有正式小程序 AppID，可以把 `project.config.json` 里的 `appid` 从 `touristappid` 改成真实 AppID；没有的话先用测试号/游客模式也可以看基础表现。
5. 点击“获取当前位置”，观察是否能拿到 `latitude` / `longitude`。
6. 点击“手动选择位置”，观察 `wx.chooseLocation` 是否能打开地图选点。

## 判断标准

- 开发者工具模拟器能返回坐标：说明 API 调用链路没写错。
- 真机调试能返回坐标：说明开发版权限、隐私声明和 AppID 配置基本可用。
- 如果用户拒绝授权，页面会显示错误信息，可以点“打开授权设置”重新授权。

## 注意

开发者工具里的坐标可能是模拟位置，不代表真实手机 GPS。最终要以“真机调试”结果为准。
