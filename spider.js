var config = require('./config.js'),
    Server = require('mongodb').Server,
    mongo = require('mongodb'),
    mongoClient = new mongo.MongoClient(new Server(config.dbServer || 'localhost', config.dbPort || 27017)),
    Fiber = require('fibers'),
    Iconv = require('iconv').Iconv,
    request = require('request'),
    https = require('http'),
    Entities = require('html-entities').XmlEntities,
    fs = require('fs'),
    cheerio = require('cheerio'),
    poster = require('./poster.js'),
    siteSections = [
        'http://www.securitylab.ru/news/',
        'http://www.securitylab.ru/analytics/',
        'http://www.securitylab.ru/contest/',
        'http://www.securitylab.ru/opinion/',
        'http://www.securitylab.ru/vulnerability/page1_1.php',
        'http://www.securitylab.ru/poc/',
        'http://www.securitylab.ru/virus/'
    ];

var db = null;

mongoClient.open(function (err) {
    if (err) {
        throw err;
    }

    poster.init(mongoClient);
    db =  mongoClient.db(config.dbName || 'securitylab');

    createIndexIfNotExists(db);

    var callback = function (err, res, body) {
        body = new Buffer(body, 'binary');
        var iconv = new Iconv('cp1251', 'utf8//IGNORE');
        body = iconv.convert(body).toString();


        try {
            var $ = cheerio.load(body);

            var messages = $('article');
            var entities = new Entities();
            var type = $('.main-title').eq(0).text().trim();

            messages.each(function () {
                var $h = $(this).find('h2').eq(0),
                    postUrl = $h.find('a').eq(0).attr('href'),
                    postId = postUrl,
                    header = entities.decode($h.find('a').eq(0).text()),
                    $news = $(this).find('.article-content, .category-article-content').clone(),
                    imageUrl = $(this).find('img').eq(0).attr('src');

                if (!postUrl) {
                    return;
                }
                postUrl = 'http://www.securitylab.ru/' + postUrl;
                console.log(postUrl);

                if (imageUrl) {
                    imageUrl = 'http://www.securitylab.ru/' + imageUrl;
                    console.log(imageUrl);
                }

                if ($news.length == 0) {
                    $news = $(this);
                }
 
                db.collection('post').findOne({'id': postId}, function (err, item) {
                    if (err || item) {
                        return;
                    }

                    db.collection('post').insert({'id': postId}, function () {});

                    var text = '[' + type + '] ' + header + '\n\n' + entities.decode($news.text()).replace(/(^[\s\t\r\n]+|[\s\t\r\n]+$)/, '');

                    if (imageUrl) {
                        var extension = imageUrl.match(/\.[\w]+$/)[0];
                        var imgFile = postId.replace(/[^\d\w]/ig, '') + (extension || '.jpg');
                        var file = fs.createWriteStream(imgFile);
                        https.get(imageUrl, function (response) {
                            response.pipe(file);
                            response.on('end', function () {
                                poster.addRequest({
                                    gid: config.gid,
                                    file: './' + imgFile,
                                    message: text,
                                    url: postUrl,
                                    delFlag: true
                                });
                            });
                        });
                    } else {
                        poster.addRequest({
                            gid: config.gid,
                            message: text,
                            url: postUrl
                        });
                    }
                });
            });

        } catch (e) {
            console.log(options);
            console.log(e);
        }
    };

    for (var i in siteSections) {
        var options = {
            uri: siteSections[i],
            encoding: 'binary'
        };

        console.log('Parse url ' + siteSections[i]);
        request(options, callback);
    }

    poster.stop();
});

function createIndexIfNotExists(db)
{
    db.collection('post').indexInformation(function (err, indexes) {
        if (!indexes.id_1) {
            console.log('creating index for collection post');
            db.createCollection('post', function (err, collection) {
                if (!err) {
                    collection.createIndex({'id': 1}, {'unique': true}, function () {});
                }
            });
        }
    });
}
