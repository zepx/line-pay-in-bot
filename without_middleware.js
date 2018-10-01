"use strict"

require("dotenv").config();

const server = require("express")();
const cache = require("memory-cache");
const debug = require("debug")("pay-test");

// Importing LINE Pay API SDK
const linePay = require("line-pay");
const pay = new linePay({
    channelId: process.env.LINE_PAY_CHANNEL_ID,
    channelSecret: process.env.LINE_PAY_CHANNEL_SECRET,
    hostname: process.env.LINE_PAY_HOSTNAME,
    isSandbox: true,
});

// Importing LINE Messaging API SDK
const lineBot = require("@line/bot-sdk");
const botConfig = {
    channelAccessToken: process.env.LINE_BOT_ACCESS_TOKEN,
    channelSecret: process.env.LINE_BOT_CHANNEL_SECRET
}
const bot = new lineBot.Client(botConfig);

server.listen(process.env.PORT || 5000);

// Webhook for Messaging API.
server.post("/webhook", lineBot.middleware(botConfig), (req, res, next) => {
    res.sendStatus(200);

    req.body.events.map((event) => {
        // We skip connection validation message.
        if (event.replyToken == "00000000000000000000000000000000" || event.replyToken == "ffffffffffffffffffffffffffffffff") return;

        // Recall the context since we save the context with userId.
        let context = cache.get(event.source.userId);

        if (!context){
            // This should be the first message.

            debug(`This should be the first message.`);

            let message = {
                type: "template",
                altText: "このチャットボットの利用は１円/月の使用料が必要です。利用を希望しますか？",
                template: {
                    type: "confirm",
                    text: "このチャットボットの利用は１円/月の使用料が必要です。利用を希望しますか？",
                    actions: [
                        {type: "postback", label: "はい", data: "yes"},
                        {type: "postback", label: "いいえ", data: "no"}
                    ]
                }
            }
            return bot.replyMessage(event.replyToken, message).then((response) => {
                cache.put(event.source.userId, {
                    subscription: "inactive"
                });
            });
        } else if (context.subscription == "inactive"){
            // This should be the answer for the question if the user like to buy the subscription.

            debug(`This should be the answer for the question if the user like to buy the subscription.`);

            if (event.type == "postback"){
                if (event.postback.data == "yes"){
                    let reservation = {
                        productName: "チャット商品",
                        amount: 1,
                        currency: "JPY",
                        confirmUrl: process.env.LINE_PAY_CONFIRM_URL || `https://${req.hostname}/pay/confirm`,
                        confirmUrlType: "SERVER",
                        orderId: `${event.source.userId}-${Date.now()}`
                    }

                    // Call LINE Pay reserve API.
                    pay.reserve(reservation).then((response) => {
                        reservation.transactionId = response.info.transactionId;
                        reservation.userId = event.source.userId;
                        cache.put(reservation.transactionId, reservation);

                        let message = {
                            type: "template",
                            altText: "支払いページへとお進み下さい",
                            template: {
                                type: "buttons",
                                text: "支払いページへとお進み下さい",
                                actions: [
                                    {type: "uri", label: "LINE Payによる支払い", uri: response.info.paymentUrl.web},
                                ]
                            }
                        }
                        // Now we can provide payment URL.
                        return bot.replyMessage(event.replyToken, message);
                    }).then((response) => {
                        return;
                    });
                } else {
                    // User does not purchase so say good bye.

                    let message = {
                        type: "text",
                        text: "わかりました！"
                    }
                    return bot.replyMessage(event.replyToken, message).then((response) => {
                        cache.del(event.source.userId);
                        return;
                    });
                }
            }
        } else if (context.subscription == "active"){
            // User has the active subscription.

            debug(`User has the active subscription.`);

            delete event.message.id;
            return bot.replyMessage(event.replyToken, event.message).then((response) => {
                return;
            });
        }
    });
});

// If user approve the payment, LINE Pay server call this webhook.
server.get("/pay/confirm", (req, res, next) => {
    if (!req.query.transactionId){
        return res.status(400).send("Transaction Id not found.");
    }

    // Retrieve the reservation from database.
    let reservation = cache.get(req.query.transactionId);
    if (!reservation){
        return res.status(400).send("Reservation not found.")
    }

    let confirmation = {
        transactionId: req.query.transactionId,
        amount: reservation.amount,
        currency: reservation.currency
    }
    return pay.confirm(confirmation).then((response) => {
        res.sendStatus(200);

        let messages = [{
            type: "sticker",
            packageId: 2,
            stickerId: 144
        },{
            type: "text",
            text: "支払いが完了しました！チャットボットの機能を利用することができます！"
        }]
        setTimeout(subscriptionTimer, 60000, reservation.userId);
        return bot.pushMessage(reservation.userId, messages);
    }).then((response) => {
        cache.put(reservation.userId, {subscription: "active"});
    });
});

function subscriptionTimer(userId) {
    let messages = [{
        type: "text",
        text: "Your subscription has expired! " + userId
    }]
    console.log("Subscription Expired: " + userId)
    cache.put(userId, {subscription: "inactive"});
    return bot.pushMessage(userId, messages);
}
