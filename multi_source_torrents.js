(function () {
    'use strict';

    // --- НАСТРОЙКИ ---
    // Замените на ВАШ настроенный URL Torrentio (если используете свой)
    // Инструкции по настройке: https://github.com/TnStark/Torrentio-Stremio-Addon (или аналогичный репозиторий)
    // Если не знаете, оставьте публичный по умолчанию, но он может быть нестабилен.
    const TORRENTIO_URL = 'https://torrentio.strem.fun';

    // URL для API The Pirate Bay (может измениться или перестать работать)
    // Пример: 'https://apibay.org' (на момент написания работает, но гарантий нет)
    // Ищет в формате: https://apibay.org/q.php?q={query}&cat=0
    const TPB_API_URL = 'https://apibay.org';

    // URL для API YTS
    const YTS_API_URL = 'https://yts.mx/api/v2/list_movies.json';
    // --- КОНЕЦ НАСТРОЕК ---


    // Вспомогательная функция для создания magnet-ссылки
    function buildMagnet(hash, name, trackers = []) {
        let magnet = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}`;
        trackers.forEach(tracker => {
            magnet += `&tr=${encodeURIComponent(tracker)}`;
        });
        return magnet;
    }

    // Вспомогательная функция для парсинга размера из строки (например, "1.2 GB", "800 MB")
    function parseSize(sizeStr) {
        if (!sizeStr || typeof sizeStr !== 'string') return 0;
        const sizeMatch = sizeStr.match(/(\d+(\.\d+)?)\s*(GB|MB|KB)/i);
        if (sizeMatch) {
            const size = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[3].toUpperCase();
            if (unit === 'GB') return Math.round(size * 1024 * 1024 * 1024);
            if (unit === 'MB') return Math.round(size * 1024 * 1024);
            if (unit === 'KB') return Math.round(size * 1024);
        }
        // Если формат неизвестен, попробуем просто как число байт
        const bytes = parseInt(sizeStr);
        return isNaN(bytes) ? 0 : bytes;
    }

     // Вспомогательная функция для парсинга сидов/пиров из строки Torrentio
     function parseTorrentioPeers(title) {
        let seeds = 0;
        let peers = 0; // Torrentio часто не разделяет их четко, считаем все как сиды
        const peersMatch = title.match(/👤\s*(\d+)/); // Ищем иконку юзера и число
        if (peersMatch) {
            seeds = parseInt(peersMatch[1]);
            peers = seeds; // Приближенно
        }
        return { seeds, peers };
    }

     // Вспомогательная функция для парсинга качества и размера из строки Torrentio
     function parseTorrentioMeta(title) {
        let quality = '';
        let size = 0;
        const qualityMatch = title.match(/\b(4K|2160p|1080p|720p|480p)\b/i);
        if (qualityMatch) {
            quality = qualityMatch[1].toUpperCase();
            if (quality === '4K') quality = '2160p'; // Стандартизируем
        }
        const sizeMatch = title.match(/💾\s*([\d.]+)\s*(GB|MB)/i); // Ищем иконку дискеты и размер
        if (sizeMatch) {
            const sizeVal = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            if (unit === 'GB') size = Math.round(sizeVal * 1024 * 1024 * 1024);
            if (unit === 'MB') size = Math.round(sizeVal * 1024 * 1024);
        }

        // Убираем метаданные из названия для чистоты
        let cleanTitle = title.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, ' '); // Убираем переносы строк
        cleanTitle = cleanTitle.replace(/👤\s*\d+/, '').replace(/💾\s*[\d.]+\s*(GB|MB)/i, '').trim();
        // Убираем начальный [PROVIDER+] если есть
         cleanTitle = cleanTitle.replace(/^\[.*?\]\s*\+?\s*/, '').trim();

        return { quality, size, title: cleanTitle };
    }


    // --- Источник: Torrentio ---
    function searchTorrentio(params, results_callback) {
        if (!params.imdb_id) {
            Lampa.Utils.log('Torrentio: IMDB ID не найден');
            return results_callback([]);
        }

        const type = params.is_serial ? 'series' : 'movie';
        let url = `${TORRENTIO_URL}/stream/${type}/${params.imdb_id}`;
        if (params.is_serial) {
            url += `:${params.season}:${params.episode}`;
        }
        url += '.json';

        Lampa.Utils.log(`Torrentio: Запрос на ${url}`);

        Lampa.Utils.fetch(url, {
            method: 'GET',
            timeout: 10000 // 10 секунд таймаут
        }).then(response => response.json()).then(data => {
            Lampa.Utils.log('Torrentio: Ответ получен');
            let results = [];
            if (data && data.streams && data.streams.length > 0) {
                data.streams.forEach(stream => {
                    if (stream.infoHash && stream.name) {
                        const { seeds, peers } = parseTorrentioPeers(stream.title || stream.name);
                        const { quality, size, title: cleanTitle } = parseTorrentioMeta(stream.title || stream.name);
                        const magnet = buildMagnet(stream.infoHash, cleanTitle, stream.sources || []); // stream.sources может содержать трекеры

                        results.push({
                            title: cleanTitle,
                            size: size, // Размер парсится из stream.title
                            seeds: seeds,
                            peers: peers,
                            quality: quality || '?', // Качество парсится из stream.title
                            magnet: magnet,
                            hash: stream.infoHash,
                            url: `https://check.torrentio.strem.fun/stream/check/${stream.infoHash}`, // Для примера, не .torrent файл
                            filename: cleanTitle, // Для отображения
                            source: 'Torrentio'
                        });
                    }
                });
                Lampa.Utils.log(`Torrentio: Найдено ${results.length} торрентов`);
            } else {
                Lampa.Utils.log('Torrentio: Торренты не найдены или ответ пуст');
            }
            results_callback(results);
        }).catch(error => {
            Lampa.Noty.show('Ошибка Torrentio: ' + error.message);
            Lampa.Utils.error('Torrentio: Ошибка при запросе', error);
            results_callback([]); // Возвращаем пустой массив в случае ошибки
        });
    }


    // --- Источник: The Pirate Bay (через API/прокси) ---
    function searchTPB(params, results_callback) {
        if (!TPB_API_URL) {
            Lampa.Utils.log('TPB: URL API не настроен');
            return results_callback([]);
        }

        let query = params.title;
        if (params.year) query += ' ' + params.year;
        if (params.is_serial) {
            // Форматируем номер сезона/эпизода, например S01E02
            const season = params.season.toString().padStart(2, '0');
            const episode = params.episode.toString().padStart(2, '0');
            query += ` S${season}E${episode}`;
        }

        const url = `${TPB_API_URL}/q.php?q=${encodeURIComponent(query)}&cat=0`; // cat=0 - все категории

        Lampa.Utils.log(`TPB: Запрос на ${url}`);

        Lampa.Utils.fetch(url, {
            method: 'GET',
            timeout: 15000 // 15 секунд таймаут
        }).then(response => response.json()).then(data => {
            Lampa.Utils.log('TPB: Ответ получен');
            let results = [];
            // Формат ответа apibay.org: массив объектов
            if (Array.isArray(data) && data.length > 0 && data[0].id !== "0") { // Проверка, что результат не пустой ("0" id означает "не найдено")
                 data.forEach(item => {
                    if (item.info_hash && item.name) {
                        // Пытаемся определить качество из названия
                        let quality = '?';
                        const qualityMatch = item.name.match(/\b(4K|2160p|1080p|720p|480p)\b/i);
                        if (qualityMatch) {
                             quality = qualityMatch[1].toUpperCase();
                             if (quality === '4K') quality = '2160p';
                         }

                        const magnet = buildMagnet(item.info_hash, item.name); // Трекеры TPB обычно добавляются клиентом

                        results.push({
                            title: item.name,
                            size: parseInt(item.size) || 0, // API возвращает размер в байтах
                            seeds: parseInt(item.seeders) || 0,
                            peers: parseInt(item.leechers) || 0,
                            quality: quality,
                            magnet: magnet,
                            hash: item.info_hash,
                            url: magnet, // Lampa часто использует url как magnet, если нет прямой ссылки
                            filename: item.name,
                            source: 'TPB'
                        });
                    }
                });
                Lampa.Utils.log(`TPB: Найдено ${results.length} торрентов`);
            } else {
                Lampa.Utils.log('TPB: Торренты не найдены или ответ пуст/некорректен');
            }
            results_callback(results);
        }).catch(error => {
            Lampa.Noty.show('Ошибка ThePirateBay: ' + error.message);
            Lampa.Utils.error('TPB: Ошибка при запросе', error);
            results_callback([]);
        });
    }

    // --- Источник: YTS (YIFY) ---
    function searchYTS(params, results_callback) {
        // YTS лучше всего работает с IMDB ID и в основном для фильмов
        if (params.is_serial) {
            Lampa.Utils.log('YTS: Пропускаем поиск для сериалов');
            return results_callback([]);
        }
        if (!params.imdb_id) {
             Lampa.Utils.log('YTS: IMDB ID не найден, пропускаем');
             return results_callback([]);
        }

        const url = `${YTS_API_URL}?query_term=${params.imdb_id}&limit=1`; // Ищем по IMDB ID, limit=1 т.к. ID уникален

        Lampa.Utils.log(`YTS: Запрос на ${url}`);

        Lampa.Utils.fetch(url, {
            method: 'GET',
            timeout: 10000
        }).then(response => response.json()).then(data => {
            Lampa.Utils.log('YTS: Ответ получен');
            let results = [];
            if (data && data.status === 'ok' && data.data && data.data.movie_count > 0 && data.data.movies && data.data.movies[0] && data.data.movies[0].torrents) {
                const movie = data.data.movies[0];
                movie.torrents.forEach(torrent => {
                    if (torrent.hash && torrent.quality) {
                        // Стандартные трекеры YTS (могут меняться)
                         const ytsTrackers = [
                             "udp://tracker.opentrackr.org:1337/announce",
                             "udp://tracker.openbittorrent.com:6969/announce",
                             "udp://open.tracker.cl:1337/announce",
                             "udp://tracker.torrent.eu.org:451/announce",
                             "udp://tracker.dler.org:6969/announce",
                             "udp://tracker.moeking.me:6969/announce",
                             "udp://tracker.piratepublic.com:1337/announce",
                             "udp://ipv4.tracker.harry.lu:80/announce"
                         ];
                        const magnet = buildMagnet(torrent.hash, `${movie.title_long} [${torrent.quality}] [YTS.MX]`, ytsTrackers);
                        const quality = torrent.quality.includes('2160p') ? '2160p' :
                                        torrent.quality.includes('1080p') ? '1080p' :
                                        torrent.quality.includes('720p') ? '720p' : '?';

                        results.push({
                            title: `${movie.title} (${movie.year}) - ${torrent.quality} [${torrent.type.toUpperCase()}]`,
                            size: parseInt(torrent.size_bytes) || 0,
                            seeds: parseInt(torrent.seeds) || 0,
                            peers: parseInt(torrent.peers) || 0,
                            quality: quality,
                            magnet: magnet,
                            hash: torrent.hash,
                            url: torrent.url, // Ссылка на .torrent файл
                            filename: `${movie.slug}-${torrent.quality}.torrent`,
                            source: 'YTS'
                        });
                    }
                });
                Lampa.Utils.log(`YTS: Найдено ${results.length} торрентов для фильма`);
            } else {
                Lampa.Utils.log('YTS: Фильм или торренты не найдены');
            }
            results_callback(results);
        }).catch(error => {
            Lampa.Noty.show('Ошибка YTS: ' + error.message);
            Lampa.Utils.error('YTS: Ошибка при запросе', error);
            results_callback([]);
        });
    }


    // --- Регистрация плагина и источников ---
    Lampa.Plugin.create( {
        name: 'MultiSource Torrents',
        version: '1.1.0',
        author: 'AI Assistant',
        description: 'Добавляет несколько источников торрентов: Torrentio, ThePirateBay (API), YTS',

        start: function () {
            Lampa.Utils.log('MultiSource Torrents: Плагин запущен');

            // Добавляем источники в Lampa
            // Lampa.Torrents.addSource принимает объект с полями name и search
            // search - это функция, которая будет вызвана Lampa при поиске
            // Она принимает 2 аргумента:
            // 1. params: объект с информацией о фильме/сериале (title, year, imdb_id, tmdb_id, season, episode, is_serial...)
            // 2. results_callback: функция, которую нужно вызвать с массивом найденных торрентов

            window.torrent_sources = window.torrent_sources || {}; // Создаем объект, если его нет

             // Регистрируем источники
             if (!window.torrent_sources.torrentio) {
                 Lampa.Torrents.addSource({
                     name: 'Torrentio',
                     search: searchTorrentio
                 });
                 window.torrent_sources.torrentio = true;
                 Lampa.Utils.log('MultiSource Torrents: Источник Torrentio добавлен');
            }

            if (!window.torrent_sources.tpb) {
                 Lampa.Torrents.addSource({
                     name: 'ThePirateBay',
                     search: searchTPB
                 });
                 window.torrent_sources.tpb = true;
                 Lampa.Utils.log('MultiSource Torrents: Источник ThePirateBay добавлен');
             }

             if (!window.torrent_sources.yts) {
                 Lampa.Torrents.addSource({
                     name: 'YTS',
                     search: searchYTS
                 });
                 window.torrent_sources.yts = true;
                 Lampa.Utils.log('MultiSource Torrents: Источник YTS добавлен');
             }

             // Небольшое уведомление о загрузке
             // Lampa.Noty.show('Плагин MultiSource Torrents загружен'); // Можно раскомментировать для отладки
        },

        destroy: function() {
            // Тут можно было бы удалять источники, но в Lampa стандартного способа removeSource нет.
            // При перезагрузке Lampa все равно переинициализирует плагины.
            // Сбрасываем флаги, чтобы при перезагрузке плагина источники добавились снова
            window.torrent_sources = {};
            Lampa.Utils.log('MultiSource Torrents: Плагин выгружен');
        }
    });

})();