#!/usr/bin/env node

/**
 * 生成标准尺寸的应用图标
 * 使用 sharp 库将原始图标转换为多个标准尺寸
 */

const fs = require('fs')
const path = require('path')

// 检查是否安装了 sharp
let sharp
try {
  sharp = require('sharp')
} catch (e) {
  console.error('Error: sharp is not installed')
  console.error('Please run: npm install --save-dev sharp')
  process.exit(1)
}

const sourceIcon = path.join(__dirname, '../build/icon.png')
const outputDir = path.join(__dirname, '../build/icons')

// 标准图标尺寸
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024]

async function generateIcons() {
  // 创建输出目录
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  console.log('Generating icons from:', sourceIcon)
  console.log('Output directory:', outputDir)

  // 读取原始图标
  const image = sharp(sourceIcon)
  const metadata = await image.metadata()

  console.log(`Source image: ${metadata.width}x${metadata.height}`)

  // 生成各种尺寸的图标
  for (const size of sizes) {
    const outputPath = path.join(outputDir, `${size}x${size}.png`)

    await sharp(sourceIcon)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(outputPath)

    console.log(`✓ Generated ${size}x${size}.png`)
  }

  // 复制一个 512x512 作为主图标
  const mainIconPath = path.join(__dirname, '../build/icon-square.png')
  await sharp(sourceIcon)
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(mainIconPath)

  console.log(`✓ Generated icon-square.png (512x512)`)
  console.log('\nAll icons generated successfully!')
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err)
  process.exit(1)
})
