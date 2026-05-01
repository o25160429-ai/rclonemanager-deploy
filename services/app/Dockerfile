FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache rclone fuse3 \
  && echo user_allow_other > /etc/fuse.conf

COPY package*.json ./
# This app only uses Firebase Realtime Database, so skip firebase-admin's
# optional Firestore/Storage dependencies in the production image.
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund --loglevel=error --no-update-notifier

COPY . .

EXPOSE 53682
CMD ["node", "src/index.js"]
