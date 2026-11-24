# セルフ毒親チェック｜子と親の心理学

自分では気づきにくい子どもへの接し方の問題や課題に気づくためのツールです。日常の場面での自分の言動を振り返り、できている強みと見直したい関わり方を確かめ、これからの接し方を考えます。

6〜17歳の子どもの保護者向け。「手軽にチェック（9問）」と「詳しくチェック（24問＋必要な追加確認）」を選べます。結果に、親のタイプ・毒親度・強みと課題・今後の接し方を表示します。質問と採点は独自設計で、医学的診断や妥当性が検証された心理尺度ではありません。

## GitHubにアップロードする

1. ZIPファイルをパソコンへダウンロードし、右クリックから「すべて展開」を選びます。
2. https://github.com/new を開きます。Repository nameの例は `self-parent-check`。一般公開する場合はPublicを選び、Add READMEをOnにしてCreate repositoryを押します。既存のこのアプリ用リポジトリを更新する場合は、そのリポジトリを開きます。
3. リポジトリのCode画面でAdd file → Upload filesを選びます。
4. 展開したフォルダを開き、その中のファイルとassetsフォルダをすべてドラッグ＆ドロップします。ZIPそのものや、外側のフォルダをアップロードしないでください。index.htmlがリポジトリの一番上に置かれる構成です。assetsの中の画像は取り出さず、フォルダ構成を保ちます。
5. Commit messageに「セルフ毒親チェックを追加」などと入力し、自分の新規リポジトリではmainブランチへの直接コミットを選んでCommit changesで保存します。画面や権限により新しいブランチへ変更を提案する場合は、そのPull Requestをmainへマージしてから次へ進みます。

ここまででファイルの保存が完了します。アプリとして一般公開するには、次のGitHub Pages設定も行ってください。

## GitHub Pagesでアプリを公開する

1. Settings → 左側のPagesを開きます。
2. Build and deploymentのSourceをDeploy from a branchにします。
3. Branchをmain、フォルダを/(root)にしてSaveを押します。
4. 公開処理が完了したら、同じPages画面のVisit siteから開きます。変更反映には最大10分程度かかる場合があります。
5. 一般に公開URLは `https://GitHubユーザー名.github.io/リポジトリ名/` の形です。実際にPages画面に表示されたURLをコピーして案内してください。

無料プランのGitHub Pagesで公開する場合はPublicリポジトリを使います。この手順ではアップロードしたソースコードや画像も公開され、アプリは一般の人が開ける状態になります。元のChatGPT側のログイン制限は引き継がれません。

## アップロード後の確認

- セルフ毒親チェックという名称と、親子のイラストが表示される。
- 9問版と24問版を選べる。
- 質問に回答でき、結果が表示される。
- 9問版の結果から「もっと詳しくチェックする」へ進める。
- スマートフォンでも文字やボタンがはみ出さない。

404の場合は、Pagesの公開状態、main / (root)、index.htmlの配置を確認してください。イラストが出ない場合はassets/parent-child-style01.pngがあるかを確認します。文字だけになる場合やボタンが動かない場合は、CSSとJSをすべてアップロードしたか確認します。

## 更新方法

同じリポジトリの同じ場所に更新ファイルをアップロードし、Commit changesで保存します。公開元のmainブランチに変更が反映されると、Pagesも更新されます。配信対象から削除された古いファイルは、必要に応じてリポジトリから削除してください。

## ファイル構成

index.html、app.js、content.js、scoring.js、quick-check.js、session.js、styles.css、app.css、favicon.svg、assets/parent-child-style01.pngをそのまま配信します。GitHub Pages用に空の.nojekyllを同梱しています。Node.jsのインストールやビルド操作は不要です。

アプリの回答処理はブラウザー内で完結します。途中保存を有効にした場合のみ同じブラウザーに保存します。保存先のサイトURLが変わるため、元のサイトで保存した回答はGitHub Pagesには自動で移りません。ページ配信・閲覧や、外部資料を開く通信は別途発生します。

## この配布版

- 準備日：2026年11月24日（日本時間）
- 元のソース版：19a8f63a2671a9d5fd8ba65c8ed5e18679a1aa3c
- アプリ本体10ファイルは公開済み最新版と同一です。
- このZIPではdistフォルダを外し、中身をリポジトリ最上位へ置きやすい構成にしています。

## 公式手順

- ファイルのアップロード：https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- 公開元の設定：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Pagesの作成と公開確認：https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
