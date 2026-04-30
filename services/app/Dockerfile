FROM node:20-alpine

# Tạo user không phải root để bảo mật
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy package files trước để tận dụng Docker cache
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy source code
COPY . .

# Tạo thư mục log và phân quyền
RUN mkdir -p /app/logs && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "index.js"]
