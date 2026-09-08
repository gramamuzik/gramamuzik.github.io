const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/search-sample', async (req, res) => {
    try {
        const { genre, key, bpm } = req.query;

        // 1. Nadir ve amatör yüklemeleri hedefleyen anahtar kelimeler
        let queryParts = [];
        if (genre && genre !== 'all') queryParts.push(genre);
        if (key && key !== 'all') queryParts.push(key);
        if (bpm) queryParts.push(`${bpm} bpm`);

        // Arama teriminin sonuna plak/nadir sample belirteçleri ekliyoruz
        queryParts.push('rare sample vinyl rip');

        // 2. Reklamlı/Monetize kanalları ve klibi olan videoları hariç tutan eksi parametreleri
        const excludeParams = '-official -vevo -mv -video -lyrics -remastered -hd -tutorial -rehber -ders -yapımı -reaction';

        const finalQuery = `${queryParts.join(' ')} ${excludeParams}`;

        const response = await youtube.search.list({
            part: 'snippet',
            q: finalQuery,
            type: 'video',
            videoCategoryId: '10', // Sadece "Müzik" kategorisi
            maxResults: 50,       // Rastgele seçim yapabilmek için geniş havuz
        });

        res.json(response.data);
    } catch (error) {
        console.error('YouTube API Hatası:', error);
        res.status(500).json({ error: 'Arama sırasında bir hata oluştu.' });
    }
});