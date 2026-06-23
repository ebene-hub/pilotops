# Node 22 — supabase-js needs native WebSocket (built in since Node 22; absent in 20).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
ENV PORT=9000
EXPOSE 9000
CMD ["node", "index.mjs"]
