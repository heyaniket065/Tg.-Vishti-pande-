export type AppLanguage = 'hinglish' | 'english' | 'hindi' | 'marathi';

export interface TranslationDictionary {
  navDashboard: string;
  navSimulator: string;
  navCrossPost: string;
  navModeration: string;
  navWelcome: string;
  navDeployment: string;
  botNotActiveTitle: string;
  botNotActiveDesc: string;
  botActiveBadge: string;
  tokenInputPlaceholder: string;
  activateBtn: string;
  activatingBtn: string;
  whereToFindToken: string;
  whereToFindTokenDesc: string;
  howToConnectTitle: string;
  step1Title: string;
  step1Desc: string;
  step2Title: string;
  step2Desc: string;
  step3Title: string;
  step3Desc: string;
  recentLiveActivity: string;
  activeGroups: string;
  activePipelines: string;
  serverStatus: string;
  refreshBtn: string;
  languageSelectLabel: string;
}

export const translations: Record<AppLanguage, TranslationDictionary> = {
  hinglish: {
    navDashboard: 'Dashboard',
    navSimulator: 'Bot Simulator',
    navCrossPost: 'Cross-Posting',
    navModeration: 'Moderation & Safety',
    navWelcome: 'Welcome Flows',
    navDeployment: 'Code & 24/7 Hosting',
    botNotActiveTitle: 'Bot abhi active nahi hai / Bot Token Configure Karein',
    botNotActiveDesc: 'Apne Telegram Bot ko live run karne ke liye BotFather se mila hua API token niche daaliye aur "Activate Bot Now" par click kijiye.',
    botActiveBadge: 'Bot 24/7 Live Hai',
    tokenInputPlaceholder: 'Jaise: 7123456789:ABCdefGHIjklMNOpqrsTUVwxyz...',
    activateBtn: 'Activate Bot Now / Bot Chalu Karein',
    activatingBtn: 'Connecting to Telegram...',
    whereToFindToken: 'Token kahan milega?',
    whereToFindTokenDesc: 'Telegram me @BotFather open karein → /mybots → apna bot select karein → API Token copy karein.',
    howToConnectTitle: '👉 Groups Kaise Connect Karein (Aap aisa karo):',
    step1Title: 'Step 1: Bot ko Group me Admin banayein',
    step1Desc: 'Apne Telegram group ya channel me bot ko add karein aur Administrator privileges dein.',
    step2Title: 'Step 2: Group me /linkgroup command run karein',
    step2Desc: 'Bot us group me ek 6-digit single-use code generate karega (jaise A7XK92).',
    step3Title: 'Step 3: Private chat me code submit karein',
    step3Desc: 'Bot ke private chat me jakar ye code send karein. Group turant aapke dashboard me link ho jayega!',
    recentLiveActivity: 'Live Activity Logs (Real Telegram Updates)',
    activeGroups: 'Connected Groups',
    activePipelines: 'Active Cross-Post Pipelines',
    serverStatus: 'Bot Engine Status',
    refreshBtn: 'Refresh Logs',
    languageSelectLabel: 'Language / भाषा:',
  },
  english: {
    navDashboard: 'Dashboard',
    navSimulator: 'Bot Simulator',
    navCrossPost: 'Cross-Posting',
    navModeration: 'Moderation & Safety',
    navWelcome: 'Welcome Flows',
    navDeployment: 'Code & 24/7 Hosting',
    botNotActiveTitle: 'Bot is not active yet / Configure Bot Token',
    botNotActiveDesc: 'To activate your Telegram bot 24/7, paste your Telegram BotFather API token below and click "Activate Bot Now".',
    botActiveBadge: 'Bot is 24/7 Live',
    tokenInputPlaceholder: 'e.g. 7123456789:ABCdefGHIjklMNOpqrsTUVwxyz...',
    activateBtn: 'Activate Bot Now',
    activatingBtn: 'Connecting to Telegram...',
    whereToFindToken: 'Where to find token?',
    whereToFindTokenDesc: 'Open @BotFather in Telegram → /mybots → select your bot → copy API Token.',
    howToConnectTitle: '👉 How to Connect Your Groups:',
    step1Title: 'Step 1: Add Bot as Admin in your Group',
    step1Desc: 'Invite the bot to your Telegram group or channel and grant Administrator rights.',
    step2Title: 'Step 2: Execute /linkgroup in the Group',
    step2Desc: 'The bot generates a secure 6-character connection code (e.g. A7XK92).',
    step3Title: 'Step 3: Submit Code in Bot Private Chat',
    step3Desc: 'Send the code in the bot private chat. Your group is immediately linked to your dashboard!',
    recentLiveActivity: 'Live Activity Logs (Real Telegram Updates)',
    activeGroups: 'Connected Groups',
    activePipelines: 'Active Cross-Post Pipelines',
    serverStatus: 'Bot Engine Status',
    refreshBtn: 'Refresh Logs',
    languageSelectLabel: 'Language:',
  },
  hindi: {
    navDashboard: 'डैशबोर्ड',
    navSimulator: 'बॉट सिम्युलेटर',
    navCrossPost: 'क्रॉस-पोस्टिंग',
    navModeration: 'मॉडरेशन व सुरक्षा',
    navWelcome: 'वेलकम फ्लो',
    navDeployment: 'कोड एवं 24/7 होस्टिंग',
    botNotActiveTitle: 'बॉट अभी सक्रिय नहीं है / बॉट टोकन जोड़ें',
    botNotActiveDesc: 'अपने टेलीग्राम बॉट को 24/7 चालू करने के लिए BotFather से मिला एपीआई टोकन नीचे पेस्ट करें और "Activate Bot Now" पर क्लिक करें।',
    botActiveBadge: 'बॉट 24/7 लाइव है',
    tokenInputPlaceholder: 'उदा. 7123456789:ABCdefGHIjklMNOpqrsTUVwxyz...',
    activateBtn: 'Activate Bot Now (बॉट चालू करें)',
    activatingBtn: 'टेलीग्राम से कनेक्ट हो रहा है...',
    whereToFindToken: 'टोकन कहाँ मिलेगा?',
    whereToFindTokenDesc: 'टेलीग्राम पर @BotFather खोलें → /mybots → अपना बॉट चुनें → API Token कॉपी करें।',
    howToConnectTitle: '👉 ग्रुप कैसे जोड़ें (आप ऐसा करें):',
    step1Title: 'स्टेप 1: बॉट को ग्रुप में एडमिन बनाएं',
    step1Desc: 'अपने ग्रुप या चैनल में बॉट को जोड़कर Administrator अधिकार दें।',
    step2Title: 'स्टेप 2: ग्रुप में /linkgroup कमांड भेजें',
    step2Desc: 'बॉट उस ग्रुप में एक 6-अक्षरों का सिंगल-यूज़ कोड जनरेट करेगा (जैसे A7XK92)।',
    step3Title: 'स्टेप 3: प्राइवेट चैट में कोड दर्ज करें',
    step3Desc: 'बॉट की प्राइवेट चैट में जाकर वह कोड भेजें। ग्रुप तुरंत आपके डैशबोर्ड में जुड़ जाएगा!',
    recentLiveActivity: 'लाइव गतिविधि लॉग्स (रियल टेलीग्राम अपडेट्स)',
    activeGroups: 'जुड़े हुए ग्रुप्स',
    activePipelines: 'सक्रिय क्रॉस-पोस्ट पाइपलाइन्स',
    serverStatus: 'बॉट इंजन स्थिति',
    refreshBtn: 'लॉग्स रीफ्रेश करें',
    languageSelectLabel: 'भाषा चुनें:',
  },
  marathi: {
    navDashboard: 'डॅशबोर्ड',
    navSimulator: 'बॉट सिम्युलेटर',
    navCrossPost: 'क्रॉस-पोस्टिंग',
    navModeration: 'मॉडरेशन व सुरक्षा',
    navWelcome: 'वेलकम सिस्टीम',
    navDeployment: 'कोड व 24/7 होस्टिंग',
    botNotActiveTitle: 'बॉट अजून सक्रिय झालेला नाही / बॉट टोकन जोडा',
    botNotActiveDesc: 'तुमच्या Telegram बॉटला 24/7 सुरू करण्यासाठी BotFather कडील टोकन खाली पेस्ट करून "Activate Bot Now" वर क्लिक करा.',
    botActiveBadge: 'बॉट 24/7 लाइव्ह आहे',
    tokenInputPlaceholder: 'उदा. 7123456789:ABCdefGHIjklMNOpqrsTUVwxyz...',
    activateBtn: 'Activate Bot Now (बॉट सुरू करा)',
    activatingBtn: 'टेलिग्रामशी कनेक्ट होत आहे...',
    whereToFindToken: 'टोकन कुठे मिळेल?',
    whereToFindTokenDesc: 'Telegram वर @BotFather उघडा → /mybots → तुमचा बॉट निवडा → API Token कॉपी करा.',
    howToConnectTitle: '👉 ग्रुप कसा जोडावा (तुम्ही असे करा):',
    step1Title: 'पायरी 1: ग्रुपमध्ये बॉटला ॲडमिन बनवा',
    step1Desc: 'तुमच्या Telegram ग्रुप किंवा चॅनेलमध्ये बॉटला ॲड करून Administrator परवानग्या द्या.',
    step2Title: 'पायरी 2: ग्रुपमध्ये /linkgroup कमांड पाठवा',
    step2Desc: 'बॉट त्या ग्रुपमध्ये 6-अक्षरी सिंगल-यूज कोड देईल (उदा. A7XK92).',
    step3Title: 'पायरी 3: खाजगी चॅटमध्ये कोड पाठवा',
    step3Desc: 'बॉटच्या खाजगी चॅटमध्ये जाऊन तो कोड पाठवा. ग्रुप तात्काळ तुमच्या डॅशबोर्डला जोडला जाईल!',
    recentLiveActivity: 'थेट घडामोडी नोंदी (Real Telegram Updates)',
    activeGroups: 'जोडलेले ग्रुप्स',
    activePipelines: 'सक्रिय क्रॉस-पोस्टिंग',
    serverStatus: 'बॉट इंजिन स्थिती',
    refreshBtn: 'लॉग्स रीफ्रेश करा',
    languageSelectLabel: 'भाषा निवडा:',
  },
};
