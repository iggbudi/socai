#!/bin/bash
cd /var/www/socai.my.id
exec node telegram-bot.js >> /tmp/bot-outer.log 2>&1
