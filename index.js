/**
 * Knight Bot - A WhatsApp Bot
 * Copyright (c) 2024 Professor
 * 
 * This program is free software: you can redistribute and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
require('./settings');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const chalk = require('chalk');
const FileType = require('file-type');
const path = require('path');
const axios = require('axios');
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber');
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif');
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc');
const { 
    default: makeWASocket,
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys");
const NodeCache = require("node-cache");
const pino = require("pino");
const readline = require("readline");
const { parsePhoneNumber } = require("libphonenumber-js");
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics');
const { rmSync, existsSync } = require('fs');
const { join } = require('path');

// Create a store object with required methods
const store = {
    messages: {},
    contacts: {},
    chats: {},
    groupMetadata: async (jid) => {
        return {}
    },
    bind: function(ev) {
        // Handle events
        ev.on('messages.upsert', ({ messages }) => {
            messages.forEach(msg => {
                if (msg.key && msg.key.remoteJid) {
                    this.messages[msg.key.remoteJid] = this.messages[msg.key.remoteJid] || {}
                    this.messages[msg.key.remoteJid][msg.key.id] = msg
                }
            })
        })
        
        ev.on('contacts.update', (contacts) => {
            contacts.forEach(contact => {
                if (contact.id) {
                    this.contacts[contact.id] = contact
                }
            })
        })
        
        ev.on('chats.set', (chats) => {
            this.chats = chats
        })
    },
    loadMessage: async (jid, id) => {
        return this.messages[jid]?.[id] || null
    }
}

global.sessions = {};

async function startSession(sessionId, phoneNumber, isPairing = false) {
    let { version, isLatest } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(`./session/${sessionId}`);
    const msgRetryCounterCache = new NodeCache();

    const bot = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !isPairing,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
            let jid = jidNormalizedUser(key.remoteJid);
            let msg = await store.loadMessage(jid, key.id);
            return msg?.message || "";
        },
        msgRetryCounterCache,
        defaultQueryTimeoutMs: undefined,
    });

    store.bind(bot.ev);
    sessions[sessionId] = { bot, number: phoneNumber };

    // Message handling
    bot.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                await handleStatus(bot, chatUpdate);
                return;
            }
            if (!bot.public && !mek.key.fromMe && chatUpdate.type === 'notify') return;
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;
            
            try {
                await handleMessages(bot, chatUpdate, true);
            } catch (err) {
                console.error("Error in handleMessages:", err);
                if (mek.key && mek.key.remoteJid) {
                    await bot.sendMessage(mek.key.remoteJid, { 
                        text: '❌ An error occurred while processing your message.',
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '2349073073347@s.whatsapp.net',
                                newsletterName: 'My WhatsApp Number',
                                serverMessageId: -1
                            }
                        }
                    }).catch(console.error);
                }
            }
        } catch (err) {
            console.error("Error in messages.upsert:", err);
        }
    });

    bot.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && decode.user + '@' + decode.server || jid;
        } else return jid;
    };

    bot.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = bot.decodeJid(contact.id);
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
        }
    });

    bot.getName = (jid, withoutContact = false) => {
        id = bot.decodeJid(jid);
        withoutContact = bot.withoutContact || withoutContact;
        let v;
        if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
            v = store.contacts[id] || {};
            if (!(v.name || v.subject)) v = bot.groupMetadata(id) || {};
            resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'));
        });
        else v = id === '0@s.whatsapp.net' ? {
            id,
            name: 'WhatsApp'
        } : id === bot.decodeJid(bot.user.id) ?
            bot.user :
            (store.contacts[id] || {});
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international');
    };

    bot.public = true;

    bot.serializeM = (m) => smsg(bot, m, store);

    if (isPairing && !bot.authState.creds.registered) {
        const phoneNumberWithoutPlus = phoneNumber.replace('+', '');
        const pn = require('awesome-phonenumber');
        if (!pn('+' + phoneNumberWithoutPlus).isValid()) {
            throw new Error('Invalid phone number');
        }

        setTimeout(async () => {
            try {
                let code = await bot.requestPairingCode(phoneNumberWithoutPlus);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                bot.ev.emit('pairing-code', code);
            } catch (error) {
                console.error('Error requesting pairing code:', error);
            }
        }, 3000);
    }

    bot.ev.on('connection.update', async (s) => {
        const { connection, lastDisconnect, qr } = s;
        if (connection === 'open') {
            console.log(chalk.magenta(` `));
            console.log(chalk.yellow(`🌿Connected to => ` + JSON.stringify(bot.user, null, 2)));
            const botNumber = bot.user.id.split(':')[0] + '@s.whatsapp.net';
            await bot.sendMessage(botNumber, { 
                text: `🤖 Bot Connected Successfully!\n\n⏰ Time: ${new Date().toLocaleString()}\n✅ Status: Online and Ready!\n✅Make sure to join below channel`,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363161513685998@newsletter',
                        newsletterName: 'KnightBot MD',
                        serverMessageId: -1
                    }
                }
            });
        }
        if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
            startSession(sessionId, phoneNumber, isPairing);
        }
        if (qr) {
            bot.ev.emit('qr', qr);
        }
    });

    bot.ev.on('creds.update', saveCreds);
    
    bot.ev.on('group-participants.update', async (update) => {
        await handleGroupParticipantUpdate(bot, update);
    });

    bot.ev.on('messages.upsert', async (m) => {
        if (m.messages[0].key && m.messages[0].key.remoteJid === 'status@broadcast') {
            await handleStatus(bot, m);
        }
    });

    bot.ev.on('status.update', async (status) => {
        await handleStatus(bot, status);
    });

    bot.ev.on('messages.reaction', async (status) => {
        await handleStatus(bot, status);
    });

    return bot;
}

async function startXeonBotInc() {
    // This function is now only for command-line execution
    // The server will call startSession directly
}

if (require.main === module) {
    startXeonBotInc().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

module.exports = { startSession };