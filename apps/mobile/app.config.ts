export default {
  expo: {
    name: 'JAMIL AI',
    slug: 'jamil-ai-mobile',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'jamilai',
    userInterfaceStyle: 'automatic',
    android: {
      package: 'com.jamilai.app',
      adaptiveIcon: { backgroundColor: '#100d2b' }
    },
    extra: {
      eas: { projectId: process.env.EAS_PROJECT_ID ?? '' }
    }
  }
};
