const db = 'results/prices.sqlite';

class Parser {
    constructor() {
        this.defaultConf = {
            version: '0.1.31',
            results: {
                flat: [
                    ['title', 'Title'],
                    ['price', 'Price'],
                    ['oldPrice', 'Old price'],
                    ['status', 'Status']
                ]
            },
            results_format: '[% tools.CSVline(query, title, status, price, oldPrice) %]',
            parsecodes: {
                200: 1
            },
            max_size: 1024 * 1024,
            token: '',
            id: ''
        };

        this.editableConf = [
            ['token', ['textfield', 'Telegram Bot token']],
            ['id', ['textfield', 'Telegram Chat ID']]
        ];
    }

    init() {
        tools.sqlite.run(db, "CREATE TABLE IF NOT EXISTS prices(url TEXT, title TEXT, price INTEGER)");
    }

    *parse(set, results) {
        let data = yield* this.getData(set.query);
        results.success = data.success;
        if(data.success) {
            let status = this.comparePrice(set.query, data.price, data.title);
            results.title = data.title;
            results.price = data.price;
            results.oldPrice = status.oldPrice;
            results.status = status.status;
            switch(status.status) {
                case 'up':
                    results.success = yield* this.send(`Цена на <a href="${set.query}">${data.title}</a> <b>повысилась</b>`);
                    break;
                case 'down':
                    results.success = yield* this.send(`Цена на <a href="${set.query}">${data.title}</a> <b>снизилась</b>`);
                    break;
            }
        }
        
        return results;
    }

    parseSingle(source, rgx) {
        try {
            return source.match(rgx)[1];
        } catch(e) {
            return '';
        }
    }

    *getData(url) {
        let result = {}, resp;
        for(let attempt = 1; attempt <= this.conf.proxyretries; attempt++) {
            resp = yield this.request('GET', url, {}, {
                attempt: attempt,
                decode: 'auto-html',
                browser: 1,
                headers: {
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36'
                }
            });
            if(resp.success) {
                try {
                    switch(this.utils.url.extractTopDomainByZone(url)) {
                        case 'mvideo.ru':
                            if(!/class="layout__content"/.test(resp.data)) throw {message: 'Content mismatch'};
                            result.price = parseFloat(this.parseSingle(resp.data, /<h1.title::text content="([^"]+)/));
                            result.title = this.parseSingle(resp.data, /<span.price__main-value::text content="([^"]+)/);
                            break;
                        case 'rozetka.com.ua':
                            if(!/class="nav-tabs-i"/.test(resp.data)) throw {message: 'Content mismatch'};
                            result.price = parseFloat(this.parseSingle(resp.data, /<meta itemprop="price" content="([^"]+)/));
                            result.title = this.parseSingle(resp.data, /<meta property="og:title" content="([^"]+)/);
                            break;
                       
                        default:
                            this.logger.put('Unknown query');
                            resp.success = 0;
                    }
                } catch(e) {
                    this.logger.put(e.message);
                    this.proxy.next();
                    resp.success = 0;
                    continue;
                }
                break;
            }
        }
        result.success = resp.success;
        return result;
    }

    comparePrice(url, price, title) {
        if(!price) return {status: 'not found', oldPrice: ''};
        let row = tools.sqlite.get(db, "SELECT * FROM prices WHERE url = ?", url);
        if(!row) {
            tools.sqlite.run(db, "INSERT INTO prices(url, title, price) VALUES(?, ?, ?)", url, title, price);
            return {status: 'new', oldPrice: ''};
        } else {
            tools.sqlite.run(db, "UPDATE prices SET title = ?, price = ? WHERE url = ?", title, price, url);
            let diff = price - (!row.price ? 0 : row.price);
            return {
                status: diff > 0 ? 'up' : diff < 0 ? 'down' : 'equal',
                oldPrice: row.price
            };
        }
    }

    *send(text) {
        if(!this.conf.token || !this.conf.id) {
        	this.logger.put('Need set Telegram parameters!');
            return false;
        }
        
        let resp = yield this.request('POST', 'https://api.telegram.org/bot' + this.conf.token + '/sendMessage', {
        	chat_id: this.conf.id,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        }, {
            use_proxy: 0,
            parsecodes: {
                200: 1,
                400: 1,
                401: 1
            }
        });
        if(!resp.success) {
            this.logger.put('Sending failed');
            return false;
        }
        
        try {
            let json = JSON.parse(resp.data);
            if(json.ok) {
                return true;
            } else {
                if(json.description)
                	this.logger.put(json.description);
                return false;
            }
        } catch(e) {
            return false;
        }
    }
}