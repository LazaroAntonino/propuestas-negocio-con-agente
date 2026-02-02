const OpenAI = require('openai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = { openai };
