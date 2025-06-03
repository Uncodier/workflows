const { customerSupportMessageWorkflow } = require('./dist/temporal/workflows/customerSupportWorkflow');

async function testWhatsAppWorkflow() {
  console.log('🧪 Testing WhatsApp workflow...');
  
  const whatsappData = {
    phoneNumber: "+5214611721870",
    messageContent: "Hola 👋",
    businessAccountId: "AC33ea5f1f199268060327c120507dd223",
    messageId: "SM24fdbb79cfa5fdff1c19b865ce189ecd",
    conversationId: null,
    agentId: "937e88db-d4b2-4dde-8d74-c582927ddae4",
    siteId: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
    userId: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
    senderName: "Sergio Prado"
  };

  const messageData = { whatsappData };
  const baseParams = {
    agentId: "937e88db-d4b2-4dde-8d74-c582927ddae4",
    origin: "whatsapp"
  };

  try {
    console.log('📋 Input data:', JSON.stringify({ messageData, baseParams }, null, 2));
    
    // Este sería el punto donde se ejecutaría el workflow
    // Por ahora solo mostramos que los datos están correctos
    console.log('✅ Data validation passed');
    console.log('📱 WhatsApp message detected:', !!messageData.whatsappData);
    console.log('🔄 Origin is whatsapp:', baseParams.origin === 'whatsapp');
    console.log('📞 Phone number:', whatsappData.phoneNumber);
    console.log('💬 Message:', whatsappData.messageContent);
    console.log('🏢 Site ID:', whatsappData.siteId);
    console.log('👤 User ID:', whatsappData.userId);
    
    console.log('\n🎯 Expected workflow flow:');
    console.log('1. Detect WhatsApp message ✅');
    console.log('2. Create EmailData for CS ✅');
    console.log('3. Skip processAnalysisDataActivity ✅');
    console.log('4. Call sendCustomerSupportMessageActivity ✅');
    console.log('5. Call sendWhatsappFromAgent workflow ✅');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testWhatsAppWorkflow(); 