const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/search-sample', async (req, res) => {
    const { genre, key, bpm, mood, country, year } = req.query;

    let queryParts = ["sample loop", "instrumental"];
    if (genre && genre !== 'all') queryParts.push(genre);
    if (key && key !== 'all') queryParts.push(key);
    if (bpm) queryParts.push(bpm + " bpm");
    if (mood && mood !== 'all') queryParts.push(mood);
    if (country && country !== 'all') queryParts.push(country);
    if (year && year !== 'all') queryParts.push(year);

    const searchQuery = queryParts.join(" ");

    try {
        const youtubeUrl = `https://www.googleapis.com/youtube/v3/search`;
        const response = await axios.get(youtubeUrl, {
            params: {
                part: 'snippet',
                type: 'video',
                maxResults: 25,
                q: searchQuery,
                key: process.env.YOUTUBE_API_KEY
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error("YouTube API Hatası:", error.response?.data || error.message);
        res.status(500).json({ error: 'YouTube araması sırasında bir hata oluştu.' });
    }
});

app.listen(PORT, () => {
    console.log(`Güvenli sunucu http://localhost:${PORT} adresinde çalışıyor.`);
    console.log("API Anahtarı Durumu:", process.env.YOUTUBE_API_KEY ? "Yüklendi (Başarılı)" : "TANIMSIZ (Okunamadı!)");
});