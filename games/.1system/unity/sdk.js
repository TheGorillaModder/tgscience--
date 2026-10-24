var YaGames = {
    init: function() {
        return Promise.resolve({
            adv: {
                showFullscreenAdv: function(opts) {
                    if (opts && opts.callbacks && opts.callbacks.onClose) opts.callbacks.onClose(true);
                },
                showRewardedVideo: function(opts) {
                    if (opts && opts.callbacks) {
                        if (opts.callbacks.onRewarded) opts.callbacks.onRewarded();
                        if (opts.callbacks.onClose) opts.callbacks.onClose();
                    }
                },
                getBannerAdvStatus: function() { return Promise.resolve({ stickyAdvIsShowing: false }); },
                showBannerAdv: function() {},
                hideBannerAdv: function() {}
            },
            features: {
                LoadingAPI: {
                    ready: function() {
                        console.log("Mock LoadingAPI.ready() called from Unity.");
                    }
                },
                GameplayAPI: {
                    start: function() {},
                    stop: function() {}
                }
            },
            getPlayer: function() {
                return Promise.resolve({
                    getName: function() { return "LocalPlayer"; },
                    getUniqueID: function() { return "local_id"; },
                    getPhoto: function() { return ""; },
                    getMode: function() { return "full"; },
                    getPayingStatus: function() { return "paying"; },
                    getData: function() { return Promise.resolve({}); },
                    setData: function() { return Promise.resolve(); }
                });
            },
            getLeaderboards: function() {
                return Promise.resolve({
                    getLeaderboardDescription: function() { return Promise.resolve({}); },
                    getLeaderboardEntries: function() { return Promise.resolve({ entries: [] }); },
                    setLeaderboardScore: function() { return Promise.resolve(); }
                });
            },
            getPayments: function() {
                return Promise.resolve({
                    getCatalog: function() { return Promise.resolve([]); },
                    getPurchases: function() { return Promise.resolve([]); },
                    purchase: function() { return Promise.resolve(); },
                    consumePurchase: function() { return Promise.resolve(); }
                });
            },
            feedback: {
                canReview: function() { return Promise.resolve({ value: false }); },
                requestReview: function() { return Promise.resolve({ feedbackSent: false }); }
            },
            shortcut: {
                canShowPrompt: function() { return Promise.resolve({ canShow: false }); },
                showPrompt: function() { return Promise.resolve({ outcome: 'dismissed' }); }
            },
            environment: {
                i18n: { lang: 'en', tld: 'com' },
                app: { id: '0' },
                browser: { lang: 'en' },
                payload: null
            },
            deviceInfo: {
                type: 'desktop',
                isMobile: function() { return false; },
                isDesktop: function() { return true; },
                isTablet: function() { return false; },
                isTV: function() { return false; }
            },
            auth: {
                openAuthDialog: function() { return Promise.resolve(); }
            }
        });
    }
};
window.YaGames = YaGames;
console.log("Mock Yandex SDK loaded locally with LoadingAPI support.");