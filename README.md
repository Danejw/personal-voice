<p align="center">
  <img src="src-tauri/icons/icon.svg" alt="Personal Voice logo" width="96" />
</p>

<h1 align="center">Personal Voice</h1>

<p align="center">
  <strong>The open-source replacement for Wispr Flow.</strong><br />
  Dictate anywhere. Own your workflow. Windows + Android.
</p>

<p align="center">
  <a href="https://github.com/Danejw/personal-voice/releases/latest"><img src="https://img.shields.io/github/v/release/Danejw/personal-voice?style=flat-square&label=release" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Android-555?style=flat-square" alt="Windows and Android" />
  <a href="https://github.com/Danejw/personal-voice/actions/workflows/validate.yml"><img src="https://github.com/Danejw/personal-voice/actions/workflows/validate.yml/badge.svg" alt="Validation status" /></a>
</p>

<p align="center">
  <a href="https://github.com/Danejw/personal-voice/releases/latest"><strong>Download Personal Voice</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#what-you-can-do">Features</a>
  &nbsp;&middot;&nbsp;
  <a href="#your-data-your-decision">Privacy</a>
  &nbsp;&middot;&nbsp;
  <a href="docs/OPEN_SOURCE.md">Self-hosting</a>
  &nbsp;&middot;&nbsp;
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

---

## Your voice is personal. Your dictation app should be too.

Emails. Messages. Code. Notes. Half-formed ideas. When you start talking to every app, your dictation tool gets a front-row seat to your life.

I built Personal Voice because I wanted more control over that. It replaced Wispr Flow in my own workflow. Now the code is open so you can make it yours.

**Your voice. Your words. Your call.**

## What you can do

| | |
| --- | --- |
| **Dictate into your apps** | Hold a shortcut, speak, and put the finished text where your cursor is. Use a floating mic on Windows or Android. |
| **Talk on one device, type on another** | Send dictation from your phone to your computer, or between your signed-in devices. |
| **Make it sound like you** | Save words in your dictionary, expand snippets, and apply text transforms. |
| **Keep your notes close** | Save notes, attach files, capture selections, and pick up where you left off. |
| **Use a real voice assistant** | Have a live Gemini conversation. With your permission, the assistant can use notes, memory, screen context, and supported device controls. |
| **See your own patterns** | Review dictation activity, assistant usage, insights, and connected devices. |

Personal Voice runs on **Windows and Android**. The two share account features, while some screen and computer controls are Windows-specific.

## Get Personal Voice

Download the latest release for your device:

| Windows | Android |
| :--- | :--- |
| [**Download Windows installer**](https://github.com/Danejw/personal-voice/releases/latest) | [**Download Android APK**](https://github.com/Danejw/personal-voice/releases/latest) |
| Windows installer and in-app updates | APK installation and release updates |

Install the app, sign in, grant the microphone and device permissions you want to use, and set your preferred dictation shortcut or floating microphone.

**Before you install:** Published builds connect to the project's configured cloud backend. They use Google Gemini for live voice processing and require a signed-in account. Review [how your data is handled](#your-data-your-decision) and the [release notes](https://github.com/Danejw/personal-voice/releases/latest).

## Your data. Your decision.

A dictation app can see the words you send into almost everything you use. You should know where that data goes.

- **Live audio:** Sent directly to Google Gemini while a voice session is active. Personal Voice does not operate its own audio-recording warehouse.
- **Dictation history:** Uploading recent dictation text is a separate opt-in setting. Saved notes and assistant conversations can sync with your account.
- **Your own deployment:** The app, Supabase migrations, and Edge Functions are in this repository. You can use a backend you control and configure your own Gemini credentials.

**A clear boundary:** Personal Voice currently uses cloud-based Gemini models. It is not an offline transcription app. Running your own backend gives you control over the application storage and infrastructure, but live audio still goes to Google for processing. API usage and hosting may cost money.

Read the [privacy and architecture details](docs/DEVELOPER_GUIDE.md#privacy-and-safety) or the [independent deployment guide](docs/OPEN_SOURCE.md).

## Open source, built to be yours

Personal Voice is built with **Tauri 2, Rust, React, TypeScript, and Android Kotlin**, with **Supabase** for account-backed features and **Google Gemini Live** for dictation and assistant sessions.

Want to run your own version, work on a feature, or understand the internals?

| Resource | Start here |
| --- | --- |
| Run your own backend | [Open-source setup and deployment](docs/OPEN_SOURCE.md) |
| Explore the implementation | [Technical guide](docs/DEVELOPER_GUIDE.md) and [architecture](docs/ARCHITECTURE.md) |
| Build on Windows or Android | [Windows guide](docs/WINDOWS.md) and [Android guide](docs/ANDROID.md) |
| Learn about the assistant tools | [Assistant implementation](docs/Assistant-Phases/README.md) |
| Ship a release | [Release guide](docs/RELEASING.md) |
| Make a contribution | [Contributing guide](CONTRIBUTING.md) |

The full documentation covers the tool harness, permissions, testing, migrations, and platform-specific behavior. Start with the [technical guide](docs/DEVELOPER_GUIDE.md) for the detailed feature breakdown and development commands.

## Contributing

Bug reports, ideas, and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before making changes, especially to the assistant's tool and permission system.

## License

Personal Voice is licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.

Personal Voice is an independent project and is not affiliated with or endorsed by Wispr Inc. **Wispr Flow** is referenced only to explain the product it replaced for its creator.
