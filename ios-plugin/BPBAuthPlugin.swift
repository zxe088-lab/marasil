// تسجيل الدخول بجوجل وابل داخل تطبيق الآيفون (أداة صغيرة خاصة بـ BPB OLD)
// ترجع رمز الدخول (idToken) للتطبيق، والتطبيق يدخل فيه Firebase
import Foundation
import Capacitor
import AuthenticationServices
import CryptoKit
import GoogleSignIn

@objc(BPBAuthPlugin)
public class BPBAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "BPBAuthPlugin"
    public let jsName = "BPBAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signInWithGoogle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise)
    ]
    private var appleCall: CAPPluginCall?
    private var currentNonce: String?

    @objc func signInWithGoogle(_ call: CAPPluginCall) {
        guard let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
              let dict = NSDictionary(contentsOfFile: path),
              let clientID = dict["CLIENT_ID"] as? String else {
            call.reject("GoogleService-Info.plist missing")
            return
        }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("no view controller"); return }
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
            GIDSignIn.sharedInstance.signIn(withPresenting: vc) { result, error in
                if let error = error {
                    let code = (error as NSError).code
                    call.reject(code == -5 ? "cancelled" : error.localizedDescription, String(code))
                    return
                }
                guard let user = result?.user, let idToken = user.idToken?.tokenString else {
                    call.reject("no Google token")
                    return
                }
                call.resolve(["idToken": idToken, "accessToken": user.accessToken.tokenString, "email": user.profile?.email ?? ""])
            }
        }
    }

    @objc func signInWithApple(_ call: CAPPluginCall) {
        let nonce = randomNonce()
        currentNonce = nonce
        appleCall = call
        let hashed = sha256(nonce)
        DispatchQueue.main.async {
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = hashed
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    @objc func signOut(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            GIDSignIn.sharedInstance.signOut()
            call.resolve()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = appleCall else { return }
        appleCall = nil
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            call.reject("no Apple token")
            return
        }
        var code = ""
        if let c = cred.authorizationCode { code = String(data: c, encoding: .utf8) ?? "" }
        call.resolve([
            "idToken": token,
            "nonce": currentNonce ?? "",
            "authorizationCode": code,
            "givenName": cred.fullName?.givenName ?? "",
            "email": cred.email ?? ""
        ])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let call = appleCall
        appleCall = nil
        let code = (error as NSError).code
        call?.reject(code == ASAuthorizationError.canceled.rawValue ? "cancelled" : error.localizedDescription, String(code))
    }

    private func randomNonce(_ length: Int = 32) -> String {
        let chars = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var gen = SystemRandomNumberGenerator()
        return String((0..<length).map { _ in chars.randomElement(using: &gen)! })
    }

    private func sha256(_ input: String) -> String {
        return SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
