-- Sonora 曲库数据库结构（MySQL 8 / MariaDB 11 通用）
-- 用法：由 scripts/db-setup.ps1 通过 mysql 客户端执行，也可手工执行：
--   mysql --defaults-file=.mysql/my.ini -u root < server/schema.sql
-- 该脚本可重复执行（CREATE ... IF NOT EXISTS），不会清空已有数据。

CREATE DATABASE IF NOT EXISTS `sonora`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `sonora`;

CREATE TABLE IF NOT EXISTS `tracks` (
  `id`             VARCHAR(64)  NOT NULL COMMENT 'sha256(JSON.stringify([name,size,lastModified])), 64 hex chars',
  `name`           VARCHAR(512) NOT NULL COMMENT '原始文件名',
  `title`          VARCHAR(255) NULL     COMMENT '显示标题',
  `artist`         VARCHAR(255) NULL     COMMENT '歌手',
  `duration`       DOUBLE       NOT NULL DEFAULT 0 COMMENT '时长（秒）',
  `size`           BIGINT       NOT NULL DEFAULT 0 COMMENT '文件字节数',
  `mime`           VARCHAR(128) NOT NULL DEFAULT '' COMMENT 'MIME type，如 audio/mpeg',
  `last_modified`  BIGINT       NOT NULL DEFAULT 0 COMMENT 'File.lastModified（epoch ms）',
  `added_at`       BIGINT       NOT NULL DEFAULT 0 COMMENT '导入时间（epoch ms）',
  `play_count`     INT          NOT NULL DEFAULT 0 COMMENT '播放次数',
  `last_played_at` BIGINT       NOT NULL DEFAULT 0 COMMENT '最近播放时间（epoch ms）',
  `audio`          LONGBLOB     NOT NULL COMMENT '原始音频二进制',
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tracks_added_at` (`added_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 自动匹配到的歌词缓存（按曲目 id 一一对应；删除曲目时一并清理）。
CREATE TABLE IF NOT EXISTS `track_lyrics` (
  `track_id`   VARCHAR(64)  NOT NULL COMMENT 'tracks.id',
  `source`     VARCHAR(32)  NOT NULL DEFAULT '' COMMENT '来源：kugou / netease / manual',
  `lrc`        MEDIUMTEXT   NOT NULL COMMENT 'LRC 歌词正文',
  `matched_title`  VARCHAR(255) NOT NULL DEFAULT '' COMMENT '匹配到的歌名',
  `matched_artist` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '匹配到的歌手',
  `fetched_at` BIGINT       NOT NULL DEFAULT 0 COMMENT '抓取时间（epoch ms）',
  PRIMARY KEY (`track_id`),
  KEY `idx_track_lyrics_fetched` (`fetched_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
